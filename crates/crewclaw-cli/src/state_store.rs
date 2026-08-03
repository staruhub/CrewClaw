//! Hardened storage for workspace-owned state below `.crewclaw/`.
//!
//! Every path component below the canonical workspace root is checked without following links.
//! Reads use a no-follow handle, enforce a size ceiling, and verify that the handle and pathname
//! still identify the same single-link regular file after the read. Writes use a mode-0600
//! create-new temporary file in the destination directory and atomically replace the destination.

use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) const MAX_STATE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_STATE_FILES: usize = 4096;
const DEFAULT_LOCK_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_STALE_AFTER: Duration = Duration::from_secs(30);
const LOCK_POLL: Duration = Duration::from_millis(10);
const LOCK_RELEASE_TIMEOUT: Duration = Duration::from_secs(1);
const LOCK_RELEASE_POLL: Duration = Duration::from_millis(1);
#[cfg(windows)]
const ATOMIC_REPLACE_TIMEOUT: Duration = Duration::from_secs(1);
#[cfg(windows)]
const ATOMIC_REPLACE_POLL: Duration = Duration::from_millis(2);

#[cfg(test)]
static UNIQUE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Eq, PartialEq)]
struct FileSnapshot {
    identity: FileIdentity,
    len: u64,
    modified: u128,
    changed: u128,
    links: u64,
}

#[cfg(unix)]
#[derive(Clone, Debug, Eq, PartialEq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

#[cfg(windows)]
#[derive(Clone, Debug, Eq, PartialEq)]
struct FileIdentity {
    volume: u32,
    index: u64,
}

#[derive(Debug, Deserialize, Serialize)]
struct LockRecord {
    token: String,
    pid: u32,
    created_at_ms: u64,
}

/// Advisory metadata from a guarded direct-directory listing. Callers must still open the
/// returned relative path through [`read`] or [`read_with_limit`]; the metadata is only suitable
/// for bounded selection and preflight budgeting because the file may change after enumeration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StateFileEntry {
    pub relative: PathBuf,
    pub len: u64,
    pub modified: SystemTime,
}

/// An owner lock remains live until dropped. Cleanup only removes the exact file/token acquired.
#[derive(Debug)]
pub(crate) struct OwnerLock {
    path: PathBuf,
    token: String,
    identity: FileIdentity,
}

impl Drop for OwnerLock {
    fn drop(&mut self) {
        let started = Instant::now();
        loop {
            match remove_lock_if_owned(&self.path, &self.identity, &self.token) {
                Ok(()) => break,
                Err(error)
                    if is_lock_release_contention(&error)
                        && started.elapsed() < LOCK_RELEASE_TIMEOUT =>
                {
                    thread::sleep(
                        LOCK_RELEASE_POLL
                            .min(LOCK_RELEASE_TIMEOUT.saturating_sub(started.elapsed())),
                    );
                }
                Err(_) => break,
            }
        }
    }
}

pub(crate) fn read(root: &Path, relative: impl AsRef<Path>) -> io::Result<Option<Vec<u8>>> {
    read_with_limit(root, relative, MAX_STATE_BYTES)
}

/// Read workspace state with a caller-selected ceiling no larger than the global 8 MiB limit.
/// The size is checked from the opened no-follow handle before allocation and again while reading.
pub(crate) fn read_with_limit(
    root: &Path,
    relative: impl AsRef<Path>,
    max_bytes: u64,
) -> io::Result<Option<Vec<u8>>> {
    if max_bytes > MAX_STATE_BYTES {
        return Err(invalid_data(
            "requested state read limit exceeds the global 8 MiB limit",
        ));
    }
    let relative = relative.as_ref();
    let Some(path) = resolve_state_target(root, relative, false)? else {
        return Ok(None);
    };
    let result = read_resolved_with_limit(&path, max_bytes)?;
    let revalidated = resolve_state_target(root, relative, false)?;
    if result.is_some() && revalidated.as_ref() != Some(&path) {
        return Err(invalid_data("state parent changed while reading"));
    }
    Ok(result)
}

pub(crate) fn read_string(root: &Path, relative: impl AsRef<Path>) -> io::Result<Option<String>> {
    let Some(bytes) = read(root, relative)? else {
        return Ok(None);
    };
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

/// List direct children of a state directory without following linked components. Returned paths
/// stay relative to `.crewclaw/` and must still be opened through [`read`] so hard-link and handle
/// identity checks are applied to every selected file.
#[cfg(test)]
pub(crate) fn list_regular_files(
    root: &Path,
    relative_dir: impl AsRef<Path>,
) -> io::Result<Vec<PathBuf>> {
    let mut files: Vec<_> = list_regular_file_entries(root, relative_dir)?
        .into_iter()
        .map(|entry| entry.relative)
        .collect();
    files.sort();
    Ok(files)
}

/// Guarded direct-directory listing with advisory size and modification metadata. Enumeration is
/// globally bounded, rejects linked directory entries, and revalidates the directory afterwards.
pub(crate) fn list_regular_file_entries(
    root: &Path,
    relative_dir: impl AsRef<Path>,
) -> io::Result<Vec<StateFileEntry>> {
    let relative_dir = relative_dir.as_ref();
    validate_relative(relative_dir)?;
    let sentinel = relative_dir.join(".__crewclaw_list_sentinel__");
    let Some(sentinel_path) = resolve_state_target(root, &sentinel, false)? else {
        return Ok(Vec::new());
    };
    let directory = sentinel_path
        .parent()
        .ok_or_else(|| invalid_data("state listing target has no parent"))?
        .to_path_buf();
    let mut files = Vec::new();
    let mut entries_seen = 0usize;
    for entry in fs::read_dir(&directory)? {
        let entry = entry?;
        entries_seen += 1;
        if entries_seen > MAX_STATE_FILES {
            return Err(invalid_data("state directory exceeds the file-count limit"));
        }
        let name = entry.file_name();
        if Path::new(&name).components().count() != 1 {
            return Err(invalid_data("state directory contains an unsafe file name"));
        }
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() || metadata_is_reparse(&metadata) {
            return Err(invalid_data(
                "state directory contains a symlink or junction",
            ));
        }
        if metadata.is_file() {
            files.push(StateFileEntry {
                relative: relative_dir.join(name),
                len: metadata.len(),
                modified: metadata.modified().unwrap_or(UNIX_EPOCH),
            });
        }
    }
    let revalidated = resolve_state_target(root, &sentinel, false)?;
    if revalidated.as_ref() != Some(&sentinel_path) {
        return Err(invalid_data("state directory changed while listing"));
    }
    Ok(files)
}

pub(crate) fn write_atomic(
    root: &Path,
    relative: impl AsRef<Path>,
    contents: &[u8],
) -> io::Result<()> {
    if contents.len() as u64 > MAX_STATE_BYTES {
        return Err(invalid_data("state output exceeds the 8 MiB limit"));
    }
    let path = resolve_state_target(root, relative.as_ref(), true)?
        .ok_or_else(|| invalid_data("state target parent unexpectedly missing"))?;
    validate_existing_target(&path)?;
    let parent = path
        .parent()
        .ok_or_else(|| invalid_data("state target has no parent"))?;
    let temp = unique_sibling_path(&path, "tmp")?;
    let mut options = secure_open_options();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp)?;
    let owned = snapshot(&file)?;
    let result = (|| {
        let revalidated = resolve_state_target(root, relative.as_ref(), true)?;
        if revalidated.as_ref() != Some(&path) {
            return Err(invalid_data("state parent changed before writing"));
        }
        file.write_all(contents)?;
        file.flush()?;
        file.sync_all()?;
        let after = snapshot(&file)?;
        if after.identity != owned.identity || after.len != contents.len() as u64 {
            return Err(invalid_data("temporary state file changed while writing"));
        }
        replace_state_file(root, relative.as_ref(), &temp, &path)?;
        sync_parent_best_effort(parent);

        let replacement = open_regular_nofollow(&path)?;
        let replacement_snapshot = snapshot(&replacement)?;
        if replacement_snapshot.identity != owned.identity
            || replacement_snapshot.links != 1
            || replacement_snapshot.len != contents.len() as u64
        {
            return Err(invalid_data("atomic state replacement failed validation"));
        }
        Ok(())
    })();
    drop(file);
    if result.is_err() {
        let _ = remove_file_if_identity(&temp, &owned.identity);
    }
    result
}

fn replace_state_file(
    root: &Path,
    relative: &Path,
    temp: &Path,
    destination: &Path,
) -> io::Result<()> {
    #[cfg(not(windows))]
    {
        let resolved_again = resolve_existing_state_target(root, relative)?;
        if resolved_again != destination {
            return Err(invalid_data("state destination changed before replacement"));
        }
        validate_existing_target(destination)?;
        atomic_replace(temp, destination)
    }

    #[cfg(windows)]
    {
        let started = Instant::now();
        loop {
            // Re-check the destination and its components before every attempt. Windows can
            // transiently deny replacement while an indexer or reader holds the old file, but a
            // retry must never skip the link/identity boundary checks.
            let resolved_again = resolve_existing_state_target(root, relative)?;
            if resolved_again != destination {
                return Err(invalid_data("state destination changed before replacement"));
            }
            validate_existing_target(destination)?;
            match atomic_replace(temp, destination) {
                Ok(()) => return Ok(()),
                Err(error)
                    if is_atomic_replace_contention(&error)
                        && started.elapsed() < ATOMIC_REPLACE_TIMEOUT =>
                {
                    thread::sleep(
                        ATOMIC_REPLACE_POLL
                            .min(ATOMIC_REPLACE_TIMEOUT.saturating_sub(started.elapsed())),
                    );
                }
                Err(error) => return Err(error),
            }
        }
    }
}

#[cfg(windows)]
fn is_atomic_replace_contention(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::PermissionDenied | io::ErrorKind::WouldBlock
    )
}

pub(crate) fn acquire_owner_lock(root: &Path, relative: impl AsRef<Path>) -> io::Result<OwnerLock> {
    acquire_owner_lock_with(
        root,
        relative.as_ref(),
        DEFAULT_LOCK_TIMEOUT,
        DEFAULT_STALE_AFTER,
    )
}

fn acquire_owner_lock_with(
    root: &Path,
    relative: &Path,
    timeout: Duration,
    stale_after: Duration,
) -> io::Result<OwnerLock> {
    validate_relative(relative)?;
    let lock_relative = lock_relative_path(relative)?;
    let lock_path = resolve_state_target(root, &lock_relative, true)?
        .ok_or_else(|| invalid_data("lock parent unexpectedly missing"))?;
    let started = Instant::now();
    loop {
        let token = unique_token()?;
        let record = LockRecord {
            token: token.clone(),
            pid: std::process::id(),
            created_at_ms: now_millis(),
        };
        let bytes = serde_json::to_vec(&record)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let mut options = secure_open_options();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&lock_path) {
            Ok(mut file) => {
                let identity = snapshot(&file)?.identity;
                if let Err(error) = (|| {
                    file.write_all(&bytes)?;
                    file.flush()?;
                    file.sync_all()
                })() {
                    drop(file);
                    let _ = remove_file_if_identity(&lock_path, &identity);
                    return Err(error);
                }
                drop(file);
                return Ok(OwnerLock {
                    path: lock_path,
                    token,
                    identity,
                });
            }
            Err(error) if is_lock_contention(&error) => {
                // Windows may report ACCESS_DENIED while the previous lock pathname is in its
                // short delete-pending window. Treat it as contention; unsafe state still fails
                // closed at the timeout rather than being overwritten.
                try_reclaim_stale_lock(&lock_path, stale_after)?;
                if started.elapsed() >= timeout {
                    return Err(io::Error::new(
                        io::ErrorKind::WouldBlock,
                        format!("timed out waiting for owner lock {}", lock_path.display()),
                    ));
                }
                thread::sleep(LOCK_POLL.min(timeout.saturating_sub(started.elapsed())));
            }
            Err(error) => return Err(error),
        }
    }
}

fn try_reclaim_stale_lock(path: &Path, stale_after: Duration) -> io::Result<()> {
    let (bytes, snap) = match read_resolved_with_snapshot(path) {
        Ok(Some(value)) => value,
        Ok(None) => return Ok(()),
        // The create-new owner writes and fsyncs immediately after publishing the pathname. A
        // contender can briefly observe the file during that write; waiting is safer than either
        // failing the caller or treating the partial record as abandoned.
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::InvalidData
                    | io::ErrorKind::NotFound
                    | io::ErrorKind::PermissionDenied
            ) =>
        {
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    let Ok(record) = serde_json::from_slice::<LockRecord>(&bytes) else {
        // A partially-created lock can belong to a live process. Fail closed instead of stealing.
        return Ok(());
    };
    let age = Duration::from_millis(now_millis().saturating_sub(record.created_at_ms));
    if age < stale_after || process_is_alive(record.pid) {
        return Ok(());
    }
    remove_lock_if_owned(path, &snap.identity, &record.token)
}

fn remove_lock_if_owned(path: &Path, identity: &FileIdentity, token: &str) -> io::Result<()> {
    let Some((bytes, snap)) = read_resolved_with_snapshot(path)? else {
        return Ok(());
    };
    if &snap.identity != identity {
        return Ok(());
    }
    let Ok(record) = serde_json::from_slice::<LockRecord>(&bytes) else {
        return Ok(());
    };
    if record.token != token {
        return Ok(());
    }
    remove_file_if_identity(path, identity)
}

fn remove_file_if_identity(path: &Path, identity: &FileIdentity) -> io::Result<()> {
    let file = match open_regular_nofollow(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let current = snapshot(&file)?;
    if &current.identity != identity {
        return Ok(());
    }
    drop(file);
    fs::remove_file(path)
}

fn read_resolved_with_limit(path: &Path, max_bytes: u64) -> io::Result<Option<Vec<u8>>> {
    read_resolved_with_snapshot_limit(path, max_bytes).map(|value| value.map(|(bytes, _)| bytes))
}

fn read_resolved_with_snapshot(path: &Path) -> io::Result<Option<(Vec<u8>, FileSnapshot)>> {
    read_resolved_with_snapshot_limit(path, MAX_STATE_BYTES)
}

fn read_resolved_with_snapshot_limit(
    path: &Path,
    max_bytes: u64,
) -> io::Result<Option<(Vec<u8>, FileSnapshot)>> {
    let mut file = match open_regular_nofollow(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let before = snapshot(&file)?;
    validate_snapshot(&before)?;
    if before.len > max_bytes {
        return Err(invalid_data(format!(
            "state file exceeds the caller read limit of {max_bytes} bytes"
        )));
    }
    let mut bytes = Vec::with_capacity(before.len as usize);
    Read::by_ref(&mut file)
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes {
        return Err(invalid_data(format!(
            "state file exceeds the caller read limit of {max_bytes} bytes"
        )));
    }
    let after = snapshot(&file)?;
    if before != after || after.len != bytes.len() as u64 {
        return Err(invalid_data("state file changed while reading"));
    }
    let path_handle = open_regular_nofollow(path)?;
    let path_snapshot = snapshot(&path_handle)?;
    validate_snapshot(&path_snapshot)?;
    if path_snapshot.identity != before.identity {
        return Err(invalid_data("state pathname changed while reading"));
    }
    Ok(Some((bytes, before)))
}

fn validate_existing_target(path: &Path) -> io::Result<()> {
    match open_regular_nofollow(path) {
        Ok(file) => validate_snapshot(&snapshot(&file)?),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn validate_snapshot(snapshot: &FileSnapshot) -> io::Result<()> {
    if snapshot.links != 1 {
        return Err(invalid_data("state file must have exactly one hard link"));
    }
    if snapshot.len > MAX_STATE_BYTES {
        return Err(invalid_data("state file exceeds the 8 MiB limit"));
    }
    Ok(())
}

fn resolve_existing_state_target(root: &Path, relative: &Path) -> io::Result<PathBuf> {
    resolve_state_target(root, relative, true)?
        .ok_or_else(|| invalid_data("state destination disappeared"))
}

fn resolve_state_target(
    root: &Path,
    relative: &Path,
    create_parent: bool,
) -> io::Result<Option<PathBuf>> {
    validate_relative(relative)?;
    let canonical_root = match fs::canonicalize(root) {
        Ok(root) => root,
        Err(error) if error.kind() == io::ErrorKind::NotFound && create_parent => {
            // State writers historically initialized a fresh workspace path. Create exactly the
            // requested root (never recursive ancestors), then establish the canonical boundary.
            match fs::create_dir(root) {
                Ok(()) => {}
                Err(create_error) if is_already_exists(&create_error) => {}
                Err(create_error) => return Err(create_error),
            }
            fs::canonicalize(root)?
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if !fs::metadata(&canonical_root)?.is_dir() {
        return Err(invalid_data("workspace root is not a directory"));
    }
    let mut current = canonical_root.clone();
    current.push(".crewclaw");
    if !ensure_directory_component(&current, create_parent)? {
        return Ok(None);
    }
    let canonical_state_root = fs::canonicalize(&current)?;
    if !canonical_state_root.starts_with(&canonical_root) {
        return Err(invalid_data(
            "state directory escapes the canonical workspace",
        ));
    }
    current = canonical_state_root;
    let mut parent_parts = relative.components().peekable();
    let mut file_name = None;
    while let Some(component) = parent_parts.next() {
        let Component::Normal(name) = component else {
            return Err(invalid_data("state path must be relative and normalized"));
        };
        if parent_parts.peek().is_none() {
            file_name = Some(name.to_os_string());
            break;
        }
        current.push(name);
        if !ensure_directory_component(&current, create_parent)? {
            return Ok(None);
        }
        let canonical = fs::canonicalize(&current)?;
        if !canonical.starts_with(&canonical_root) {
            return Err(invalid_data("state path escapes the canonical workspace"));
        }
        current = canonical;
    }
    let file_name = file_name.ok_or_else(|| invalid_data("state path has no file name"))?;
    current.push(file_name);
    if !current.starts_with(&canonical_root) {
        return Err(invalid_data("state target escapes the canonical workspace"));
    }
    Ok(Some(current))
}

fn validate_relative(relative: &Path) -> io::Result<()> {
    if relative.as_os_str().is_empty() || relative.is_absolute() {
        return Err(invalid_data("state path must be a non-empty relative path"));
    }
    let components: Vec<_> = relative.components().collect();
    if components.is_empty()
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(invalid_data("state path contains an unsafe component"));
    }
    Ok(())
}

fn ensure_directory_component(path: &Path, create: bool) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => validate_directory_metadata(&metadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound && create => {
            match fs::create_dir(path) {
                Ok(()) => {}
                Err(create_error) if is_already_exists(&create_error) => {}
                Err(create_error) => return Err(create_error),
            }
            let metadata = fs::symlink_metadata(path)?;
            validate_directory_metadata(&metadata)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn validate_directory_metadata(metadata: &fs::Metadata) -> io::Result<bool> {
    if metadata.file_type().is_symlink() || metadata_is_reparse(metadata) {
        return Err(invalid_data("state path contains a symlink or junction"));
    }
    if !metadata.is_dir() {
        return Err(invalid_data("state path component is not a directory"));
    }
    Ok(true)
}

fn lock_relative_path(relative: &Path) -> io::Result<PathBuf> {
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    let name = relative
        .file_name()
        .ok_or_else(|| invalid_data("state lock target has no file name"))?;
    let mut lock_name = OsString::from(".");
    lock_name.push(name);
    lock_name.push(".lock");
    Ok(parent.join(lock_name))
}

fn unique_sibling_path(path: &Path, suffix: &str) -> io::Result<PathBuf> {
    let mut name = OsString::from(".");
    name.push(path.file_name().unwrap_or_default());
    name.push(format!(".{}.{}", unique_token()?, suffix));
    Ok(path.with_file_name(name))
}

fn unique_token() -> io::Result<String> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut random = [0u8; 16];
    getrandom::fill(&mut random)
        .map_err(|error| io::Error::other(format!("OS random source failed: {error}")))?;
    let mut token = String::with_capacity(random.len() * 2);
    for byte in random {
        token.push(HEX[(byte >> 4) as usize] as char);
        token.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(token)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

fn invalid_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn is_lock_contention(error: &io::Error) -> bool {
    if matches!(
        error.kind(),
        io::ErrorKind::AlreadyExists | io::ErrorKind::PermissionDenied
    ) {
        return true;
    }
    #[cfg(windows)]
    {
        // Depending on the filesystem/API path, CREATE_NEW reports either ERROR_FILE_EXISTS (80)
        // or ERROR_ALREADY_EXISTS (183); the latter is not consistently classified by std.
        matches!(error.raw_os_error(), Some(5 | 80 | 183))
    }
    #[cfg(not(windows))]
    false
}

fn is_lock_release_contention(error: &io::Error) -> bool {
    if is_lock_contention(error) {
        return true;
    }
    #[cfg(windows)]
    {
        // ERROR_SHARING_VIOLATION: a contender or scanner can briefly retain a read handle after
        // the owner has finished. Retrying release avoids leaving a live-process lock orphaned.
        error.raw_os_error() == Some(32)
    }
    #[cfg(not(windows))]
    false
}

fn is_already_exists(error: &io::Error) -> bool {
    if error.kind() == io::ErrorKind::AlreadyExists {
        return true;
    }
    #[cfg(windows)]
    {
        matches!(error.raw_os_error(), Some(80 | 183))
    }
    #[cfg(not(windows))]
    false
}

fn secure_open_options() -> OpenOptions {
    let mut options = OpenOptions::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options
}

fn open_regular_nofollow(path: &Path) -> io::Result<File> {
    let mut options = secure_open_options();
    let file = options.read(true).open(path)?;
    let snap = snapshot(&file)?;
    validate_snapshot(&snap)?;
    Ok(file)
}

#[cfg(unix)]
fn snapshot(file: &File) -> io::Result<FileSnapshot> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() {
        return Err(invalid_data("state target is not a regular file"));
    }
    let modified = ((metadata.mtime() as i128) << 64) | metadata.mtime_nsec() as i128;
    let changed = ((metadata.ctime() as i128) << 64) | metadata.ctime_nsec() as i128;
    Ok(FileSnapshot {
        identity: FileIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        },
        len: metadata.len(),
        modified: modified as u128,
        changed: changed as u128,
        links: metadata.nlink(),
    })
}

#[cfg(windows)]
fn snapshot(file: &File) -> io::Result<FileSnapshot> {
    use std::mem::zeroed;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        GetFileInformationByHandle,
    };
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { zeroed() };
    let ok = unsafe {
        GetFileInformationByHandle(file.as_raw_handle() as _, std::ptr::addr_of_mut!(info))
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    if info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
        return Err(invalid_data("state target is not a regular link-free file"));
    }
    Ok(FileSnapshot {
        identity: FileIdentity {
            volume: info.dwVolumeSerialNumber,
            index: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
        },
        len: ((info.nFileSizeHigh as u64) << 32) | info.nFileSizeLow as u64,
        modified: ((info.ftLastWriteTime.dwHighDateTime as u128) << 32)
            | info.ftLastWriteTime.dwLowDateTime as u128,
        changed: 0,
        links: info.nNumberOfLinks as u64,
    })
}

#[cfg(unix)]
fn metadata_is_reparse(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(windows)]
fn metadata_is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(unix)]
fn atomic_replace(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn atomic_replace(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_parent_best_effort(parent: &Path) {
    let _ = File::open(parent).and_then(|directory| directory.sync_all());
}

#[cfg(windows)]
fn sync_parent_best_effort(parent: &Path) {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    };
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT);
    let _ = options
        .open(parent)
        .and_then(|directory| directory.sync_all());
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    let result = unsafe { libc::kill(pid, 0) };
    if result == 0 {
        return true;
    }
    io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    if pid == 0 {
        return false;
    }
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        // ERROR_INVALID_PARAMETER is how OpenProcess reports a PID that does not exist. Access
        // denied (for example another user's live process) and unknown failures must stay live/
        // unknown so a valid owner is never stolen.
        return io::Error::last_os_error().raw_os_error() != Some(87);
    }
    let mut exit_code = 0u32;
    let ok = unsafe { GetExitCodeProcess(handle, &mut exit_code) };
    unsafe { CloseHandle(handle) };
    ok != 0 && exit_code == STILL_ACTIVE as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "crewclaw-state-store-{name}-{}-{}",
            std::process::id(),
            UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).expect("create test root");
        path
    }

    #[cfg(windows)]
    #[allow(clippy::permissions_set_readonly_false)]
    fn restore_writable(path: &Path) {
        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions).expect("restore writable");
    }

    #[test]
    fn atomic_write_replaces_existing_and_bounded_read_round_trips() {
        let root = root("replace");
        write_atomic(&root, "team.json", b"old").expect("write old");
        write_atomic(&root, "team.json", b"new").expect("replace existing");
        assert_eq!(
            read(&root, "team.json").expect("read"),
            Some(b"new".to_vec())
        );
        assert_eq!(
            read_with_limit(&root, "team.json", 3).expect("exact caller limit"),
            Some(b"new".to_vec())
        );
        assert_eq!(
            read_with_limit(&root, "team.json", 2)
                .expect_err("caller limit rejects before an oversized allocation")
                .kind(),
            io::ErrorKind::InvalidData
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn atomic_write_retries_a_transient_windows_destination_lock() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

        let root = root("replace-contention");
        write_atomic(&root, "team.json", b"old").expect("write old");
        let destination = root.join(".crewclaw").join("team.json");
        let locked = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&destination)
            .expect("hold destination without delete sharing");
        let release = thread::spawn(move || {
            thread::sleep(Duration::from_millis(40));
            drop(locked);
        });

        write_atomic(&root, "team.json", b"new")
            .expect("replace after the transient destination lock clears");
        release.join().expect("release lock");
        assert_eq!(
            read(&root, "team.json").expect("read"),
            Some(b"new".to_vec())
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn safe_directory_listing_returns_relative_regular_files_only() {
        let root = root("listing");
        write_atomic(&root, "runs/task_one.json", b"{}").expect("first run");
        write_atomic(&root, "runs/task_two.json", b"{}").expect("second run");
        let files = list_regular_files(&root, "runs").expect("safe listing");
        assert_eq!(
            files,
            vec![
                PathBuf::from("runs/task_one.json"),
                PathBuf::from("runs/task_two.json")
            ]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn oversized_and_hardlinked_state_files_are_rejected() {
        let root = root("unsafe-files");
        let dir = root.join(".crewclaw");
        fs::create_dir(&dir).expect("state dir");
        fs::write(
            dir.join("large.json"),
            vec![b'x'; MAX_STATE_BYTES as usize + 1],
        )
        .expect("large file");
        assert_eq!(
            read(&root, "large.json")
                .expect_err("oversize rejected")
                .kind(),
            io::ErrorKind::InvalidData
        );
        fs::write(dir.join("linked.json"), b"secret").expect("source");
        fs::hard_link(dir.join("linked.json"), dir.join("alias.json")).expect("hardlink");
        assert_eq!(
            read(&root, "linked.json")
                .expect_err("hardlink rejected")
                .kind(),
            io::ErrorKind::InvalidData
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn live_stale_owner_is_not_stolen_and_dead_stale_owner_is_recovered() {
        let root = root("owner");
        let first = acquire_owner_lock(&root, "team.json").expect("first lock");
        let error = acquire_owner_lock_with(
            &root,
            Path::new("team.json"),
            Duration::from_millis(40),
            Duration::ZERO,
        )
        .expect_err("live owner must not be stolen");
        assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
        drop(first);

        let lock_relative = lock_relative_path(Path::new("team.json")).expect("lock relative");
        let dead = LockRecord {
            token: "dead-owner".to_string(),
            pid: u32::MAX,
            created_at_ms: 0,
        };
        write_atomic(
            &root,
            &lock_relative,
            &serde_json::to_vec(&dead).expect("serialize"),
        )
        .expect("dead lock");
        let recovered = acquire_owner_lock_with(
            &root,
            Path::new("team.json"),
            Duration::from_secs(1),
            Duration::ZERO,
        )
        .expect("recover dead owner");
        drop(recovered);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn owner_lock_serializes_concurrent_read_modify_write() {
        let root = Arc::new(root("stress"));
        write_atomic(&root, "counter", b"0").expect("seed");
        let workers = 8;
        let rounds = 20;
        let barrier = Arc::new(Barrier::new(workers));
        let mut joins = Vec::new();
        for _ in 0..workers {
            let root = Arc::clone(&root);
            let barrier = Arc::clone(&barrier);
            joins.push(thread::spawn(move || {
                barrier.wait();
                for _ in 0..rounds {
                    // This test deliberately creates an unfair eight-thread lock convoy. Hosted
                    // Windows runners can spend most of the production timeout flushing the other
                    // 159 atomic writes, so use a test-local budget and assert serialization rather
                    // than scheduler fairness.
                    let _lock = acquire_owner_lock_with(
                        &root,
                        Path::new("counter"),
                        Duration::from_secs(30),
                        DEFAULT_STALE_AFTER,
                    )
                    .expect("lock");
                    let current = read_string(&root, "counter")
                        .expect("read")
                        .expect("counter")
                        .parse::<u64>()
                        .expect("integer");
                    write_atomic(&root, "counter", (current + 1).to_string().as_bytes())
                        .expect("write");
                }
            }));
        }
        for join in joins {
            join.join().expect("worker");
        }
        assert_eq!(
            read_string(&root, "counter").expect("read").as_deref(),
            Some((workers * rounds).to_string().as_str())
        );
        let _ = fs::remove_dir_all(root.as_ref());
    }

    #[cfg(windows)]
    #[test]
    fn junction_component_is_rejected_without_writing_outside() {
        use std::process::Command;
        let workspace = root("junction");
        let outside = root("junction-outside");
        let junction = workspace.join(".crewclaw");
        let status = Command::new("cmd")
            .args([
                "/c",
                "mklink",
                "/J",
                junction.to_string_lossy().as_ref(),
                outside.to_string_lossy().as_ref(),
            ])
            .status()
            .expect("create junction");
        assert!(status.success(), "mklink /J must succeed");
        assert_eq!(
            write_atomic(&workspace, "team.json", b"blocked")
                .expect_err("junction rejected")
                .kind(),
            io::ErrorKind::InvalidData
        );
        assert!(!outside.join("team.json").exists());
        fs::remove_dir(&junction).expect("remove junction");
        let _ = fs::remove_dir_all(workspace);
        let _ = fs::remove_dir_all(outside);
    }

    #[cfg(windows)]
    #[test]
    fn failed_readonly_replacement_preserves_old_contents() {
        let root = root("replace-failure");
        write_atomic(&root, "prefs.json", b"old").expect("seed");
        let target = root.join(".crewclaw").join("prefs.json");
        let mut permissions = fs::metadata(&target).expect("metadata").permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&target, permissions).expect("readonly target");
        let error =
            write_atomic(&root, "prefs.json", b"new").expect_err("replacement should be blocked");
        assert_ne!(error.kind(), io::ErrorKind::NotFound);
        assert_eq!(fs::read(&target).expect("old target"), b"old");
        restore_writable(&target);
        let _ = fs::remove_dir_all(root);
    }
}
