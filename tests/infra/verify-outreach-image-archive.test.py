#!/usr/bin/env python3

from __future__ import annotations

import base64
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import unittest
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "infra/verify-outreach-image-archive.py"
EXPECTED_REF = f"nikufra-outreach:release-{'a' * 40}-123-1"
OCI_INDEX = "application/vnd.oci.image.index.v1+json"
OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"


def json_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def blob_name(data: bytes) -> str:
    return f"blobs/sha256/{digest(data).removeprefix('sha256:')}"


def descriptor(media_type: str, content: bytes, **extra: Any) -> dict[str, Any]:
    return {
        "mediaType": media_type,
        "digest": digest(content),
        "size": len(content),
        **extra,
    }


def add_regular(bundle: tarfile.TarFile, name: str, data: bytes) -> None:
    member = tarfile.TarInfo(name)
    member.size = len(data)
    member.mode = 0o400
    member.mtime = 0
    bundle.addfile(member, io.BytesIO(data))


def write_archive(path: pathlib.Path, members: list[tuple[str, bytes]]) -> None:
    with tarfile.open(path, "w:") as bundle:
        for name, data in members:
            add_regular(bundle, name, data)


def legacy_fixture(path: pathlib.Path, *, duplicate_manifest: bool = False) -> str:
    config = json_bytes(
        {
            "architecture": "amd64",
            "os": "linux",
            "rootfs": {"type": "layers", "diff_ids": []},
        }
    )
    layer = b"legacy-layer-tar-fixture"
    config_name = f"{digest(config).removeprefix('sha256:')}.json"
    manifest = json_bytes(
        [
            {
                "Config": config_name,
                "RepoTags": [EXPECTED_REF],
                "Layers": ["legacy-layer/layer.tar"],
            }
        ]
    )
    members = [
        ("manifest.json", manifest),
        (config_name, config),
        ("legacy-layer/layer.tar", layer),
    ]
    if duplicate_manifest:
        members.append(("manifest.json", manifest))
    write_archive(path, members)
    return digest(config)


def oci_fixture(
    path: pathlib.Path,
    *,
    bind_runtime: bool = True,
    corrupt_inline_data: bool = False,
    mark_runnable_as_attestation: bool = False,
    omit_root_annotations: bool = False,
    wrong_root_annotations: bool = False,
    root_size_delta: int = 0,
    corrupt_root_blob: bool = False,
) -> str:
    runtime_config = json_bytes(
        {
            "architecture": "amd64",
            "os": "linux",
            "rootfs": {"type": "layers", "diff_ids": ["sha256:" + "1" * 64]},
        }
    )
    runtime_layers = [b"runtime-layer-one", b"runtime-layer-two"]

    if bind_runtime:
        graph_config = runtime_config
        graph_layers = runtime_layers
    else:
        graph_config = json_bytes(
            {
                "architecture": "arm64",
                "os": "linux",
                "rootfs": {"type": "layers", "diff_ids": ["sha256:" + "2" * 64]},
            }
        )
        graph_layers = [b"unrelated-layer"]

    runnable_manifest = json_bytes(
        {
            "schemaVersion": 2,
            "mediaType": OCI_MANIFEST,
            "config": descriptor("application/vnd.oci.image.config.v1+json", graph_config),
            "layers": [
                descriptor("application/vnd.oci.image.layer.v1.tar", layer)
                for layer in graph_layers
            ],
        }
    )

    attestation_config = b"{}"
    attestation_layer = json_bytes({"_type": "https://in-toto.io/Statement/v0.1"})
    attestation_manifest = json_bytes(
        {
            "schemaVersion": 2,
            "mediaType": OCI_MANIFEST,
            "config": descriptor(
                "application/vnd.oci.empty.v1+json",
                attestation_config,
                data=base64.b64encode(
                    b"not-empty-config" if corrupt_inline_data else attestation_config
                ).decode("ascii"),
            ),
            "layers": [
                descriptor("application/vnd.in-toto+json", attestation_layer)
            ],
        }
    )

    root_index = json_bytes(
        {
            "schemaVersion": 2,
            "mediaType": OCI_INDEX,
            "manifests": [
                descriptor(
                    OCI_MANIFEST,
                    runnable_manifest,
                    annotations=(
                        {"vnd.docker.reference.type": "attestation-manifest"}
                        if mark_runnable_as_attestation
                        else {}
                    ),
                    platform={"architecture": "amd64", "os": "linux"},
                ),
                descriptor(
                    OCI_MANIFEST,
                    attestation_manifest,
                    annotations={
                        "vnd.docker.reference.digest": digest(runnable_manifest),
                        "vnd.docker.reference.type": "attestation-manifest",
                    },
                    platform={"architecture": "unknown", "os": "unknown"},
                ),
            ],
        }
    )
    root_id = digest(root_index)
    expected_tag = EXPECTED_REF.rpartition(":")[2]
    top_descriptor = descriptor(
        OCI_INDEX,
        root_index,
        **(
            {}
            if omit_root_annotations
            else {
                "annotations": {
                    "io.containerd.image.name": (
                        "docker.io/library/unrelated:overwritten"
                        if wrong_root_annotations
                        else f"docker.io/library/{EXPECTED_REF}"
                    ),
                    "org.opencontainers.image.ref.name": (
                        "overwritten" if wrong_root_annotations else expected_tag
                    ),
                }
            }
        ),
    )
    top_descriptor["size"] += root_size_delta
    index = json_bytes(
        {
            "schemaVersion": 2,
            "mediaType": OCI_INDEX,
            "manifests": [top_descriptor],
        }
    )
    docker_manifest = json_bytes(
        [
            {
                "Config": blob_name(runtime_config),
                "RepoTags": [EXPECTED_REF],
                "Layers": [blob_name(layer) for layer in runtime_layers],
            }
        ]
    )

    blobs = {
        blob_name(runtime_config): runtime_config,
        **{blob_name(layer): layer for layer in runtime_layers},
        blob_name(graph_config): graph_config,
        **{blob_name(layer): layer for layer in graph_layers},
        blob_name(runnable_manifest): runnable_manifest,
        blob_name(attestation_config): attestation_config,
        blob_name(attestation_layer): attestation_layer,
        blob_name(attestation_manifest): attestation_manifest,
        blob_name(root_index): root_index + (b"\n" if corrupt_root_blob else b""),
    }
    members = [
        ("manifest.json", docker_manifest),
        ("oci-layout", json_bytes({"imageLayoutVersion": "1.0.0"})),
        ("index.json", index),
        *sorted(blobs.items()),
    ]
    write_archive(path, members)
    return root_id


class VerifyOutreachImageArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory(prefix="outreach-archive-test-")
        self.work = pathlib.Path(self.tempdir.name)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def run_validator(
        self,
        archive: pathlib.Path,
        expected_id: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(VALIDATOR), str(archive), expected_id, EXPECTED_REF],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def assert_rejected(
        self,
        archive: pathlib.Path,
        expected_id: str,
        message: str,
    ) -> None:
        result = self.run_validator(archive, expected_id)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(message, result.stderr)

    def test_accepts_legacy_archive_bound_to_config_digest(self) -> None:
        archive = self.work / "legacy.tar"
        expected_id = legacy_fixture(archive)
        result = self.run_validator(archive, expected_id)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_accepts_oci_index_with_runnable_manifest_and_attestation(self) -> None:
        archive = self.work / "oci.tar"
        expected_id = oci_fixture(archive)
        result = self.run_validator(archive, expected_id)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_accepts_oci_index_without_optional_root_annotations(self) -> None:
        archive = self.work / "oci-no-root-annotations.tar"
        expected_id = oci_fixture(archive, omit_root_annotations=True)
        result = self.run_validator(archive, expected_id)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_expected_id_not_declared_by_top_level_index(self) -> None:
        archive = self.work / "wrong-id.tar"
        oci_fixture(archive)
        self.assert_rejected(
            archive,
            "sha256:" + "0" * 64,
            "Raiz OCI não corresponde ao Image ID declarado",
        )

    def test_rejects_root_not_bound_to_docker_manifest_config_and_layers(self) -> None:
        archive = self.work / "unbound.tar"
        expected_id = oci_fixture(archive, bind_runtime=False)
        self.assert_rejected(
            archive,
            expected_id,
            "não contém exatamente um manifest executável",
        )

    def test_does_not_count_attestation_as_runnable_manifest(self) -> None:
        archive = self.work / "attestation-only.tar"
        expected_id = oci_fixture(archive, mark_runnable_as_attestation=True)
        self.assert_rejected(
            archive,
            expected_id,
            "não contém exatamente um manifest executável",
        )

    def test_rejects_descriptor_size_mismatch(self) -> None:
        archive = self.work / "wrong-size.tar"
        expected_id = oci_fixture(archive, root_size_delta=1)
        self.assert_rejected(archive, expected_id, "Digest ou tamanho diverge")

    def test_rejects_corrupted_root_blob(self) -> None:
        archive = self.work / "corrupt-root.tar"
        expected_id = oci_fixture(archive, corrupt_root_blob=True)
        self.assert_rejected(archive, expected_id, "Digest ou tamanho diverge")

    def test_rejects_inline_descriptor_data_with_wrong_digest(self) -> None:
        archive = self.work / "bad-inline-data.tar"
        expected_id = oci_fixture(archive, corrupt_inline_data=True)
        self.assert_rejected(archive, expected_id, "Dados embebidos divergem")

    def test_rejects_root_annotations_for_an_unrelated_tag(self) -> None:
        archive = self.work / "wrong-root-annotations.tar"
        expected_id = oci_fixture(archive, wrong_root_annotations=True)
        self.assert_rejected(archive, expected_id, "Annotations da raiz OCI")

    def test_rejects_duplicate_tar_members(self) -> None:
        archive = self.work / "duplicate.tar"
        expected_id = legacy_fixture(archive, duplicate_manifest=True)
        self.assert_rejected(archive, expected_id, "Membro duplicado")

    def test_rejects_symlink_tar_members(self) -> None:
        archive = self.work / "symlink.tar"
        config = b"{}"
        config_name = f"{digest(config).removeprefix('sha256:')}.json"
        manifest = json_bytes(
            [
                {
                    "Config": config_name,
                    "RepoTags": [EXPECTED_REF],
                    "Layers": ["layer.tar"],
                }
            ]
        )
        with tarfile.open(archive, "w:") as bundle:
            add_regular(bundle, "manifest.json", manifest)
            config_member = tarfile.TarInfo(config_name)
            config_member.type = tarfile.SYMTYPE
            config_member.linkname = "real-config.json"
            bundle.addfile(config_member)
            add_regular(bundle, "real-config.json", config)
            add_regular(bundle, "layer.tar", b"layer")
        self.assert_rejected(archive, digest(config), "Membro não regular")


if __name__ == "__main__":
    unittest.main()
