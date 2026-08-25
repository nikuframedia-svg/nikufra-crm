use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const SERVICE: &str = "ai.nikufra.crm.auth";
const CHUNK_BYTES: usize = 1_800;
const MAX_SECRET_BYTES: usize = 128 * 1024;
static GENERATION_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize)]
struct SecretMetadata {
    generation: String,
    chunks: usize,
}

fn validate_key(key: &str) -> Result<(), String> {
    if !(key.starts_with("sb-") && key.len() <= 240) {
        return Err("Chave de sessão inválida".into());
    }
    if !key
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err("Chave de sessão inválida".into());
    }
    Ok(())
}

fn metadata_entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key)
        .map_err(|error| format!("Não foi possível abrir o cofre do sistema: {error}"))
}

fn chunk_entry(key: &str, generation: &str, index: usize) -> Result<Entry, String> {
    Entry::new(SERVICE, &format!("{key}:{generation}:{index}"))
        .map_err(|error| format!("Não foi possível abrir o cofre do sistema: {error}"))
}

fn read_metadata(key: &str) -> Result<Option<SecretMetadata>, String> {
    match metadata_entry(key)?.get_password() {
        Ok(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|_| "Metadados da sessão no cofre estão danificados".into()),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Não foi possível ler a sessão do cofre: {error}")),
    }
}

fn delete_generation(key: &str, metadata: &SecretMetadata) -> Result<(), String> {
    let mut first_error = None;
    for index in 0..metadata.chunks {
        match chunk_entry(key, &metadata.generation, index)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => {}
            Err(error) if first_error.is_none() => {
                first_error = Some(format!(
                    "Não foi possível limpar a sessão anterior: {error}"
                ));
            }
            Err(_) => {}
        }
    }
    first_error.map_or(Ok(()), Err)
}

fn next_generation() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = GENERATION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{timestamp:x}{counter:x}")
}

fn get_secret(key: &str) -> Result<Option<String>, String> {
    validate_key(key)?;
    let Some(metadata) = read_metadata(key)? else {
        return Ok(None);
    };
    if metadata.chunks == 0 || metadata.chunks > (MAX_SECRET_BYTES / CHUNK_BYTES) + 1 {
        return Err("Metadados da sessão no cofre são inválidos".into());
    }

    let mut bytes = Vec::new();
    for index in 0..metadata.chunks {
        let chunk = chunk_entry(key, &metadata.generation, index)?
            .get_secret()
            .map_err(|error| format!("A sessão guardada está incompleta: {error}"))?;
        if chunk.len() > CHUNK_BYTES {
            return Err("Um fragmento da sessão guardada é inválido".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() > MAX_SECRET_BYTES {
        return Err("A sessão guardada excede o limite de segurança".into());
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "A sessão guardada não contém texto válido".into())
}

fn set_secret(key: &str, value: &str) -> Result<(), String> {
    validate_key(key)?;
    if value.len() > MAX_SECRET_BYTES {
        return Err("A sessão excede o limite de segurança".into());
    }

    let previous = read_metadata(key)?;
    let generation = next_generation();
    let chunks: Vec<&[u8]> = if value.is_empty() {
        vec![&[]]
    } else {
        value.as_bytes().chunks(CHUNK_BYTES).collect()
    };
    let metadata = SecretMetadata {
        generation,
        chunks: chunks.len(),
    };

    for (index, chunk) in chunks.iter().enumerate() {
        if let Err(error) = chunk_entry(key, &metadata.generation, index)?.set_secret(chunk) {
            let _ = delete_generation(key, &metadata);
            return Err(format!(
                "Não foi possível guardar a sessão no cofre: {error}"
            ));
        }
    }

    let serialized = serde_json::to_string(&metadata)
        .map_err(|_| "Não foi possível serializar a sessão".to_string())?;
    if let Err(error) = metadata_entry(key)?.set_password(&serialized) {
        let _ = delete_generation(key, &metadata);
        return Err(format!(
            "Não foi possível confirmar a sessão no cofre: {error}"
        ));
    }
    if let Some(previous) = previous {
        delete_generation(key, &previous)?;
    }
    Ok(())
}

fn remove_secret(key: &str) -> Result<(), String> {
    validate_key(key)?;
    if let Some(metadata) = read_metadata(key)? {
        delete_generation(key, &metadata)?;
    }
    match metadata_entry(key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Não foi possível remover a sessão do cofre: {error}"
        )),
    }
}

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| "O cofre seguro terminou inesperadamente".to_string())?
}

#[tauri::command]
pub async fn secure_storage_get(key: String) -> Result<Option<String>, String> {
    blocking(move || get_secret(&key)).await
}

#[tauri::command]
pub async fn secure_storage_set(key: String, value: String) -> Result<(), String> {
    blocking(move || set_secret(&key, &value)).await
}

#[tauri::command]
pub async fn secure_storage_remove(key: String) -> Result<(), String> {
    blocking(move || remove_secret(&key)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_supabase_session_keys() {
        assert!(validate_key("sb-crm.nikufra.ai-auth-token").is_ok());
        assert!(validate_key("sb-host-flow-0123456789-code-verifier").is_ok());
        assert!(validate_key("other-secret").is_err());
        assert!(validate_key("sb-invalid/path").is_err());
    }

    #[test]
    fn chunks_cover_windows_credential_limits() {
        let value = vec![b'x'; CHUNK_BYTES * 3 + 7];
        let chunks: Vec<&[u8]> = value.chunks(CHUNK_BYTES).collect();
        assert_eq!(chunks.len(), 4);
        assert_eq!(chunks.concat(), value);
    }
}
