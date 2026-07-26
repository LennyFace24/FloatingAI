fn main() {
    embed_test_manifest();
    tauri_build::build()
}

/// Tauri embeds a common-controls v6 manifest into the main binary, but test
/// executables get none. Without it, Windows resolves `comctl32.dll` to the
/// SxS v5 copy, which lacks `TaskDialogIndirect`, and every test binary dies
/// with STATUS_ENTRYPOINT_NOT_FOUND before `main`. Compile the manifest into
/// a resource object and link it into test binaries only.
fn embed_test_manifest() {
    if std::env::var("CARGO_CFG_WINDOWS").is_err() {
        return;
    }
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_env != "gnu" {
        // MSVC toolchains embed manifests via tauri-build/embed-manifest paths.
        return;
    }

    let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR not set"));
    let manifest_dir =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let rc_path = manifest_dir.join("manifest/test.rc");
    let res_path = out_dir.join("test-manifest.o");

    let status = std::process::Command::new("windres")
        .arg("--input")
        .arg(&rc_path)
        .arg("--output")
        .arg(&res_path)
        .arg("--output-format=coff")
        .current_dir(&manifest_dir)
        .status();

    match status {
        Ok(status) if status.success() => {
            println!("cargo::rustc-link-arg={}", res_path.display());
            println!("cargo::rerun-if-changed=manifest/test.rc");
            println!("cargo::rerun-if-changed=manifest/test.manifest");
        }
        Ok(status) => println!("cargo:warning=windres exited with {status}; test manifest skipped"),
        Err(error) => println!("cargo:warning=windres unavailable ({error}); test manifest skipped"),
    }
}
