#!/usr/bin/env python3
"""Validate a Docker image archive against its immutable runtime identity."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import pathlib
import re
import sys
import tarfile
from collections.abc import Iterable
from typing import Any, NoReturn


MAX_MEMBERS = 100_000
MAX_MANIFEST_SIZE = 1024 * 1024
MAX_OCI_DOCUMENT_SIZE = 4 * 1024 * 1024
MAX_INLINE_DATA_SIZE = 4 * 1024 * 1024
MAX_OCI_DESCRIPTORS = 4_096
MAX_OCI_DEPTH = 8
READ_CHUNK_SIZE = 1024 * 1024

OCI_INDEX_MEDIA_TYPES = {
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
}
OCI_MANIFEST_MEDIA_TYPES = {
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
}
SHA256_RE = re.compile(r"sha256:([0-9a-f]{64})")


class ArchiveValidationError(Exception):
    """The archive cannot be bound safely to the declared image identity."""


def refuse(message: str) -> NoReturn:
    raise ArchiveValidationError(message)


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            refuse(f"Campo JSON duplicado: {key}")
        result[key] = value
    return result


def safe_archive_name(name: str, *, directory: bool = False) -> str:
    candidate = name[:-1] if directory and name.endswith("/") else name
    if (
        not candidate
        or candidate.startswith("/")
        or "\\" in candidate
        or "\x00" in candidate
        or any(part in {"", ".", ".."} for part in candidate.split("/"))
    ):
        refuse(f"Caminho inseguro no archive Outreach: {name}")
    path = pathlib.PurePosixPath(candidate)
    if path.is_absolute() or path.as_posix() != candidate:
        refuse(f"Caminho não canónico no archive Outreach: {name}")
    return candidate


def parse_digest(value: Any, *, context: str) -> tuple[str, str]:
    if not isinstance(value, str):
        refuse(f"Digest ausente em {context}")
    match = SHA256_RE.fullmatch(value)
    if match is None:
        refuse(f"Digest SHA-256 inválido em {context}")
    return value, match.group(1)


class ArchiveValidator:
    def __init__(self, bundle: tarfile.TarFile, expected_id: str, expected_ref: str):
        self.bundle = bundle
        self.expected_id = expected_id
        self.expected_ref = expected_ref
        self.members: dict[str, tarfile.TarInfo] = {}
        self.digest_cache: dict[str, str] = {}
        self.visited_descriptors: set[str] = set()
        self.descriptor_count = 0
        self.matching_manifests: list[str] = []
        self.legacy_config: tuple[str, int] | None = None
        self.legacy_layers: list[tuple[str, int]] = []
        self._index_members()

    def _index_members(self) -> None:
        for member in self.bundle:
            name = safe_archive_name(member.name, directory=member.isdir())
            if name in self.members:
                refuse(f"Membro duplicado no archive Outreach: {name}")
            if not (member.isfile() or member.isdir()):
                refuse(f"Membro não regular no archive Outreach: {name}")
            self.members[name] = member
            if len(self.members) > MAX_MEMBERS:
                refuse("Archive Outreach excede o limite de membros")

    def regular_member(self, name: str, *, context: str) -> tarfile.TarInfo:
        safe_archive_name(name)
        member = self.members.get(name)
        if member is None or not member.isfile():
            refuse(f"{context} ausente ou não regular: {name}")
        return member

    def read_bytes(self, name: str, *, context: str, limit: int) -> bytes:
        member = self.regular_member(name, context=context)
        if member.size < 0 or member.size > limit:
            refuse(f"{context} excede o limite: {name}")
        stream = self.bundle.extractfile(member)
        if stream is None:
            refuse(f"{context} ilegível: {name}")
        data = stream.read(limit + 1)
        if len(data) != member.size:
            refuse(f"Tamanho real diverge em {context}: {name}")
        return data

    def read_json(self, name: str, *, context: str, limit: int) -> Any:
        data = self.read_bytes(name, context=context, limit=limit)
        try:
            return json.loads(
                data.decode("utf-8"),
                object_pairs_hook=strict_object,
                parse_constant=lambda value: refuse(
                    f"Constante JSON inválida em {context}: {value}"
                ),
            )
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            refuse(f"JSON inválido em {context}: {error}")

    def member_digest(self, name: str, *, context: str) -> tuple[str, int]:
        member = self.regular_member(name, context=context)
        cached = self.digest_cache.get(name)
        if cached is None:
            stream = self.bundle.extractfile(member)
            if stream is None:
                refuse(f"{context} ilegível: {name}")
            digest = hashlib.sha256()
            total = 0
            while True:
                chunk = stream.read(READ_CHUNK_SIZE)
                if not chunk:
                    break
                digest.update(chunk)
                total += len(chunk)
            if total != member.size:
                refuse(f"Tamanho real diverge em {context}: {name}")
            cached = f"sha256:{digest.hexdigest()}"
            self.digest_cache[name] = cached
        return cached, member.size

    def verify_blob(
        self,
        digest: Any,
        size: Any,
        *,
        context: str,
    ) -> tuple[str, int, str]:
        parsed_digest, hex_digest = parse_digest(digest, context=context)
        if type(size) is not int or size < 0:
            refuse(f"Tamanho inválido em {context}")
        name = f"blobs/sha256/{hex_digest}"
        actual_digest, actual_size = self.member_digest(name, context=context)
        if actual_digest != parsed_digest or actual_size != size:
            refuse(f"Digest ou tamanho diverge em {context}")
        return parsed_digest, size, name

    @staticmethod
    def require_schema(document: Any, media_type: str, *, context: str) -> dict[str, Any]:
        if (
            not isinstance(document, dict)
            or type(document.get("schemaVersion")) is not int
            or document.get("schemaVersion") != 2
        ):
            refuse(f"Documento OCI inválido em {context}")
        declared_media_type = document.get("mediaType")
        if declared_media_type is not None and declared_media_type != media_type:
            refuse(f"Media type diverge em {context}")
        return document

    @staticmethod
    def descriptor_fields(
        descriptor: Any,
        *,
        context: str,
        allowed_media_types: set[str] | None = None,
    ) -> tuple[str, str, int]:
        if not isinstance(descriptor, dict):
            refuse(f"Descriptor inválido em {context}")
        media_type = descriptor.get("mediaType")
        if not isinstance(media_type, str) or not media_type:
            refuse(f"Media type ausente em {context}")
        if allowed_media_types is not None and media_type not in allowed_media_types:
            refuse(f"Media type não suportado em {context}: {media_type}")
        if "urls" in descriptor:
            refuse(f"Descriptor externo recusado em {context}")
        annotations = descriptor.get("annotations")
        if annotations is not None and (
            not isinstance(annotations, dict)
            or any(
                not isinstance(key, str) or not isinstance(value, str)
                for key, value in annotations.items()
            )
        ):
            refuse(f"Annotations inválidas em {context}")
        platform = descriptor.get("platform")
        if platform is not None and (
            not isinstance(platform, dict)
            or not isinstance(platform.get("architecture"), str)
            or not platform.get("architecture")
            or not isinstance(platform.get("os"), str)
            or not platform.get("os")
        ):
            refuse(f"Platform inválida em {context}")
        digest, _ = parse_digest(descriptor.get("digest"), context=context)
        size = descriptor.get("size")
        if type(size) is not int or size < 0:
            refuse(f"Tamanho inválido em {context}")
        return media_type, digest, size

    @staticmethod
    def verify_inline_data(
        descriptor: dict[str, Any],
        digest: str,
        size: int,
        *,
        context: str,
    ) -> None:
        encoded = descriptor.get("data")
        if encoded is None:
            return
        if (
            not isinstance(encoded, str)
            or len(encoded) > ((MAX_INLINE_DATA_SIZE + 2) // 3) * 4
        ):
            refuse(f"Dados embebidos inválidos em {context}")
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ArchiveValidationError(
                f"Base64 inválido nos dados embebidos em {context}"
            ) from error
        if base64.b64encode(decoded).decode("ascii") != encoded:
            refuse(f"Base64 não canónico nos dados embebidos em {context}")
        actual_digest = f"sha256:{hashlib.sha256(decoded).hexdigest()}"
        if len(decoded) != size or actual_digest != digest:
            refuse(f"Dados embebidos divergem do descriptor em {context}")

    @staticmethod
    def is_runnable_manifest(descriptor: dict[str, Any], document: dict[str, Any]) -> bool:
        annotations = descriptor.get("annotations") or {}
        if annotations.get("vnd.docker.reference.type") is not None:
            return False
        platform = descriptor.get("platform") or {}
        if platform.get("architecture") == "unknown" and platform.get("os") == "unknown":
            return False
        if document.get("subject") is not None or document.get("artifactType") is not None:
            return False
        return True

    def verify_data_descriptor(self, descriptor: Any, *, context: str) -> tuple[str, int]:
        _, digest, size = self.descriptor_fields(descriptor, context=context)
        self.verify_inline_data(descriptor, digest, size, context=context)
        self.verify_blob(digest, size, context=context)
        return digest, size

    def read_legacy_manifest(self) -> None:
        manifest = self.read_json(
            "manifest.json",
            context="manifest Docker",
            limit=MAX_MANIFEST_SIZE,
        )
        if not isinstance(manifest, list) or len(manifest) != 1:
            refuse("Archive Outreach deve conter exatamente uma imagem")
        entry = manifest[0]
        if not isinstance(entry, dict):
            refuse("Entrada inválida no manifest Docker")
        if entry.get("RepoTags") != [self.expected_ref]:
            refuse("Archive Outreach contém referência inesperada")

        config = entry.get("Config")
        if not isinstance(config, str):
            refuse("Config ausente no archive Outreach")
        self.legacy_config = self.member_digest(config, context="Config da imagem Outreach")

        layers = entry.get("Layers")
        if not isinstance(layers, list) or not layers or len(layers) > MAX_OCI_DESCRIPTORS:
            refuse("Archive Outreach não contém uma lista válida de layers")
        for position, layer in enumerate(layers):
            if not isinstance(layer, str):
                refuse(f"Layer inválida no archive Outreach: {position}")
            self.legacy_layers.append(
                self.member_digest(layer, context=f"Layer Outreach {position}")
            )

    def walk_descriptor(self, descriptor: Any, *, context: str, depth: int) -> None:
        if depth > MAX_OCI_DEPTH:
            refuse("Grafo OCI excede a profundidade permitida")
        media_type, digest, size = self.descriptor_fields(
            descriptor,
            context=context,
            allowed_media_types=OCI_INDEX_MEDIA_TYPES | OCI_MANIFEST_MEDIA_TYPES,
        )
        if digest in self.visited_descriptors:
            refuse(f"Descriptor OCI repetido ou cíclico: {digest}")
        self.visited_descriptors.add(digest)
        self.descriptor_count += 1
        if self.descriptor_count > MAX_OCI_DESCRIPTORS:
            refuse("Grafo OCI excede o limite de descriptors")

        self.verify_inline_data(descriptor, digest, size, context=context)
        _, _, blob_name = self.verify_blob(digest, size, context=context)
        document = self.read_json(
            blob_name,
            context=context,
            limit=MAX_OCI_DOCUMENT_SIZE,
        )
        document = self.require_schema(document, media_type, context=context)

        if media_type in OCI_INDEX_MEDIA_TYPES:
            children = document.get("manifests")
            if (
                not isinstance(children, list)
                or not children
                or len(children) > MAX_OCI_DESCRIPTORS
            ):
                refuse(f"Índice OCI sem descriptors válidos em {context}")
            for position, child in enumerate(children):
                self.walk_descriptor(
                    child,
                    context=f"{context}/manifests/{position}",
                    depth=depth + 1,
                )
            return

        config = document.get("config")
        layers = document.get("layers")
        if not isinstance(layers, list) or not layers or len(layers) > MAX_OCI_DESCRIPTORS:
            refuse(f"Manifest OCI sem layers válidas em {context}")
        config_identity = self.verify_data_descriptor(
            config,
            context=f"{context}/config",
        )
        layer_identities = [
            self.verify_data_descriptor(
                layer,
                context=f"{context}/layers/{position}",
            )
            for position, layer in enumerate(layers)
        ]
        if (
            self.is_runnable_manifest(descriptor, document)
            and config_identity == self.legacy_config
            and layer_identities == self.legacy_layers
        ):
            self.matching_manifests.append(digest)

    def validate(self) -> None:
        parse_digest(self.expected_id, context="Image ID declarado")
        if not self.expected_ref:
            refuse("Referência Outreach vazia")
        self.read_legacy_manifest()
        if self.legacy_config is None:
            refuse("Config da imagem Outreach ausente")

        # Classic Docker stores identify an image by the SHA-256 of its config.
        # This branch still authenticates the bytes, rather than trusting the
        # config filename stored in manifest.json.
        if self.legacy_config[0] == self.expected_id:
            return

        layout = self.read_json(
            "oci-layout",
            context="layout OCI",
            limit=4096,
        )
        if not isinstance(layout, dict) or layout.get("imageLayoutVersion") != "1.0.0":
            refuse("Layout OCI ausente ou incompatível")

        index = self.read_json(
            "index.json",
            context="índice OCI do archive",
            limit=MAX_OCI_DOCUMENT_SIZE,
        )
        if (
            not isinstance(index, dict)
            or type(index.get("schemaVersion")) is not int
            or index.get("schemaVersion") != 2
        ):
            refuse("Índice OCI inválido no archive Outreach")
        index_media_type = index.get("mediaType")
        if index_media_type is not None and index_media_type not in OCI_INDEX_MEDIA_TYPES:
            refuse("Media type inválido no índice OCI do archive")
        roots = index.get("manifests")
        if not isinstance(roots, list) or len(roots) != 1:
            refuse("Archive Outreach deve declarar exatamente uma raiz OCI")
        _, separator, expected_tag = self.expected_ref.rpartition(":")
        if not separator or not expected_tag:
            refuse("Referência Outreach não contém uma tag válida")
        _, root_digest, _ = self.descriptor_fields(
            roots[0],
            context="raiz OCI",
            allowed_media_types=OCI_INDEX_MEDIA_TYPES | OCI_MANIFEST_MEDIA_TYPES,
        )
        if root_digest != self.expected_id:
            refuse("Raiz OCI não corresponde ao Image ID declarado")
        root_annotations = roots[0].get("annotations") or {}
        expected_annotations = {
            "io.containerd.image.name": f"docker.io/library/{self.expected_ref}",
            "org.opencontainers.image.ref.name": expected_tag,
        }
        for key, expected_value in expected_annotations.items():
            actual_value = root_annotations.get(key)
            if actual_value is not None and actual_value != expected_value:
                refuse("Annotations da raiz OCI não correspondem à referência declarada")

        self.walk_descriptor(roots[0], context="raiz OCI", depth=0)
        if len(self.matching_manifests) != 1:
            refuse(
                "Raiz OCI não contém exatamente um manifest executável "
                "correspondente ao archive Docker"
            )


def validate_archive(archive: pathlib.Path, expected_id: str, expected_ref: str) -> None:
    try:
        with tarfile.open(archive, "r:") as bundle:
            ArchiveValidator(bundle, expected_id, expected_ref).validate()
    except (OSError, tarfile.TarError) as error:
        refuse(f"Archive Outreach ilegível: {error}")


def main(arguments: Iterable[str]) -> int:
    args = list(arguments)
    if len(args) != 3:
        print(
            "Uso: verify-outreach-image-archive.py <archive> <image-id> <image-ref>",
            file=sys.stderr,
        )
        return 2
    archive, expected_id, expected_ref = args
    try:
        validate_archive(pathlib.Path(archive), expected_id, expected_ref)
    except ArchiveValidationError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
