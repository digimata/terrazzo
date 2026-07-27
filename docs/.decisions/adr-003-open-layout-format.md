# ADR-003 :: Open layout format and agent-safe mutation

Last updated: `2026.07.27`

Status: **Proposed**

> Keep one JSON layout sidecar per directory as Terrazzo's canonical spatial state. Publish the schema, add namespaced extension fields, and expose validated mutations through a CLI backed by the same Rust service as the application. Use JSON Canvas for import and export, not as the internal schema.

## Table of Contents

1. [Decision](#1-decision)
   - [1.1 — Canonical storage](#11--canonical-storage)
   - [1.2 — Concurrency token](#12--concurrency-token)
   - [1.3 — Extension contract](#13--extension-contract)
2. [Mutation contract](#2-mutation-contract)
   - [2.1 — Application running](#21--application-running)
   - [2.2 — Application closed](#22--application-closed)
   - [2.3 — Direct file editing](#23--direct-file-editing)
3. [JSON Canvas interoperability](#3-json-canvas-interoperability)
4. [Rationale](#4-rationale)
5. [Alternatives](#5-alternatives)
6. [Design implications](#6-design-implications)
7. [Adoption sequence](#7-adoption-sequence)
8. [When to revisit](#8-when-to-revisit)

---

## 1. Decision

Terrazzo will keep `.canvas/layout.json` as the canonical presentation state for each directory. The format remains distinct from JSON Canvas because Terrazzo projects a real directory into one canonical canvas and must preserve file identity across renames, external changes, and temporary absence.

The schema is part of the product contract. It will be documented, versioned, validated, and covered by compatibility tests. Content files remain authoritative. Losing `.canvas/layout.json` loses arrangement and presentation metadata, never the underlying files.

### 1.1 — Canonical storage

Schema version 2 adds explicit extension containers while preserving the version 1 item model:

```json
{
  "schemaVersion": 2,
  "items": {
    "0198ee75-7512-7c42-a9c7-8edfa0123148": {
      "path": "launch-video.mov",
      "lastSeen": {
        "device": 16777234,
        "inode": 9127341,
        "mtimeNs": "1785112300123456789",
        "size": 48392012
      },
      "frame": {
        "x": 960,
        "y": 320,
        "width": 640,
        "height": 360
      },
      "rotation": 0,
      "zIndex": 4,
      "extensions": {}
    }
  },
  "extensions": {}
}
```

The contract is:

1. `items` remains a map keyed by durable file UUID. The file UUID is also the canonical card identity while Terrazzo permits one placement per directory child.
2. `path` is relative to the directory that owns the sidecar.
3. `lastSeen` is a reconciliation hint. It is refreshed from the filesystem and is never independent authority.
4. `frame`, `rotation`, and `zIndex` are presentation state.
5. Coordinates and dimensions are finite JSON numbers. Width and height must be positive.
6. `mtimeNs` remains a decimal string because nanosecond timestamps exceed JavaScript's safe integer range.
7. Core serialization is deterministic. UUID keys are sorted and object fields have stable order.
8. Unknown schema versions are not rewritten. Terrazzo opens them read-only or reports that an upgrade is required.

Layout files do not store file contents, thumbnail bytes, Markdown text, application settings, API credentials, or generated-media provenance.

### 1.2 — Concurrency token

The mutation API returns an opaque revision token computed from the exact canonical layout bytes. The token is not stored inside `layout.json`.

```json
{
  "revision": "sha256:b128f2...",
  "items": []
}
```

Every conditional mutation supplies the revision it inspected. The writer acquires the layout lock, reads the current bytes, recomputes the token, and rejects the mutation if the tokens differ.

```text
revision_conflict: layout changed after inspection
```

A content-derived token detects supported mutations, manual file edits, reconciliation writes, and changes made by another process. A stored integer counter would miss edits whose writer forgot to increment it.

### 1.3 — Extension contract

Optional `extensions` objects exist at the layout and item levels. Extension keys use reverse-domain names:

```json
{
  "extensions": {
    "com.digimata.terrazzo.agent-notes": {
      "intent": "four-column comparison"
    }
  }
}
```

Terrazzo preserves extension values verbatim across supported reads and writes. Core behavior does not depend on an extension unless that extension is promoted into the versioned schema.

Extensions are data only. They cannot inject scripts, CSS, remote resources, filesystem paths, commands, or executable behavior. Extension size is bounded so a layout file cannot become an unbounded object store.

---

## 2. Mutation contract

All supported writers use one Rust layout service. Tauri commands, the CLI, migrations, and future plugins do not implement separate serialization or reconciliation logic.

The minimum CLI surface is:

```text
terrazzo layout inspect <directory> --json
terrazzo layout apply <directory> --if-revision <token> --file <deltas.json>
```

`inspect` discovers the nearest workspace root, verifies that the directory is inside it, reconciles the filesystem listing, and returns renderable items with the current revision.

`apply` accepts a batch of typed deltas. A batch either lands completely or leaves the layout unchanged.

### 2.1 — Application running

The active Terrazzo process is the only layout writer for its workspace.

On macOS, the Rust backend listens on a private Unix domain socket. The CLI discovers the socket through a user-private runtime descriptor and sends a versioned request. The active process validates the workspace, directory, revision, UUIDs, coordinates, and extension bounds before writing.

After persistence succeeds, the backend emits an internal event to the webview. An open `CanvasView` applies the confirmed deltas to its tldraw projection without recording them as a second user mutation. The CLI waits for the response and exits non-zero on validation, persistence, or revision failure.

The socket is local only. It is held in a per-user directory, protected by filesystem permissions and a per-session token. No TCP port is opened.

### 2.2 — Application closed

When no Terrazzo process owns the workspace, the CLI acquires the same workspace/layout lock and calls the shared Rust service directly.

The write sequence is:

1. Acquire the lock.
2. Read the complete existing file.
3. Compare the expected revision.
4. Parse, validate, and migrate supported schemas.
5. Reconcile item identity against the directory.
6. Apply the complete delta batch in memory.
7. Serialize deterministically to a sibling temporary file.
8. Flush the temporary file.
9. Atomically rename it over `layout.json`.
10. Sync the parent directory where the platform supports it.
11. Release the lock and return the new revision.

If the runtime descriptor claims that an application is active but the CLI cannot reach it, the CLI fails safely. It does not write behind a possibly live process.

### 2.3 — Direct file editing

Users may inspect, back up, version, and repair `layout.json` with ordinary tools. Direct mutation is supported only while Terrazzo is not using that workspace.

On the next open, Terrazzo validates the file before reconciliation. Invalid JSON, non-finite coordinates, non-positive dimensions, malformed UUIDs, or an unsupported schema version produce a recoverable error. Terrazzo does not silently replace a malformed sidecar with an empty layout.

Agents should use the CLI rather than edit the sidecar directly. The CLI provides path-boundary validation, durable-ID resolution, atomic batches, and revision conflict detection.

---

## 3. JSON Canvas interoperability

Obsidian's JSON Canvas format stores a canvas as a standalone `.canvas` document with `nodes` and `edges`. Nodes carry an ID, type, integer position, and dimensions. File nodes reference vault-relative paths. Array order defines z-order. The format supports text, file, link, and group nodes and is published under the MIT license. [1](https://jsoncanvas.org/spec/1.0/) [2](https://github.com/obsidianmd/jsoncanvas)

Terrazzo will support JSON Canvas as an interchange format:

```text
terrazzo canvas export <directory> --format json-canvas
terrazzo canvas import <file.canvas> --into <directory>
```

The base mapping is:

| Terrazzo | JSON Canvas |
| --- | --- |
| Item UUID | Node `id` |
| Relative path | File node `file` |
| `frame.x`, `frame.y` | `x`, `y` |
| `frame.width`, `frame.height` | `width`, `height` |
| Sorted `zIndex` | Node array order |

JSON Canvas 1.0 has no standard fields for Terrazzo's filesystem fingerprint, tombstone state, rotation, or directory reconciliation. Export omits those fields or places them in a documented Terrazzo extension. Import creates or resolves Terrazzo identities through the normal directory reconciliation path.

JSON Canvas does not become canonical storage. Its model permits many authored canvases over selected files. Terrazzo's canonical canvas contains the renderable children of one directory, whether or not the user manually added them.

---

## 4. Rationale

JSON fits the expected unit of state. A directory canvas normally contains tens or hundreds of items. Whole-file parsing and deterministic atomic replacement are simple at that scale. The sidecar remains readable without Terrazzo and travels with the directory.

Obsidian demonstrates the value of publishing a canvas format as an interoperability surface. JSON Canvas was created for longevity, readability, extensibility, and user ownership, and third-party tools can implement it without depending on Obsidian's private runtime. [2](https://github.com/obsidianmd/jsoncanvas)

Obsidian also demonstrates the limits of a standalone whole-file artifact. Its file nodes are path references rather than durable filesystem identities, and Obsidian staff state that Canvas sync uses last-writer-wins without smart merging or conflict copies. [3](https://forum.obsidian.md/t/canvas-sync-support-smart-merging-of-changes-and-or-generate-conflict/103920) Terrazzo retains UUID and filesystem reconciliation and adds conditional mutation rather than adopting path-only identity or uncontrolled last-writer-wins.

The format and the mutation protocol solve different problems. JSON gives the user durable ownership. The Rust service gives active processes safe coordination. Keeping the format open does not require accepting concurrent blind writes.

---

## 5. Alternatives

| Alternative | Judgment |
| --- | --- |
| Adopt JSON Canvas as canonical | Rejected. It cannot represent Terrazzo's implicit directory membership, reconciliation fingerprint, tombstones, or rotation without product-specific extensions. |
| Store one `.canvas` document per user-created view | Deferred. Named alternate views may become useful, but v0 keeps one canonical arrangement per directory. |
| Workspace SQLite database | Rejected as canonical storage. It gives stronger transactions and queries but makes arrangement opaque and separates it from the directory it describes. |
| SQLite derived index over JSON | Allowed later. Search and cross-directory queries may use a rebuildable cache while JSON remains authoritative. |
| JSON Lines operation log | Rejected for current state. It complicates compaction and recovery without providing collaboration semantics by itself. |
| CRDT or event-sourced layout | Deferred until concurrent multi-device or collaborative editing is a real requirement. |
| Direct agent edits to `layout.json` | Rejected as the normal mutation path. It cannot coordinate safely with the active tldraw projection. |

---

## 6. Design implications

- The Rust layout module becomes a reusable service rather than Tauri-command implementation detail.
- The application and CLI share workspace discovery, path validation, reconciliation, locking, migrations, delta validation, serialization, and atomic writes.
- The webview remains a projection. It does not become the persistence authority.
- A live application must react to confirmed external mutations without remounting the canvas or creating a persistence echo.
- Revision tokens are opaque API values. Callers compare them but do not parse or construct them.
- Schema migrations are explicit, version-to-version functions with fixture tests.
- Extension data is retained through migration and reconciliation.
- A schema conformance document and representative fixtures ship in the repository.
- JSON Canvas import and export are tested against the public 1.0 examples.
- A future named-view model must separate file identity from placement identity. It is not added preemptively to the canonical v2 schema.

---

## 7. Adoption sequence

1. Publish the version 1 schema and add read/write round-trip fixtures for the current implementation.
2. Harden atomic durability and add workspace/layout locking.
3. Add content-derived revision tokens to the Rust mutation API.
4. Implement conditional batch mutations and retryable conflict errors.
5. Add the version 2 extension containers with a tested v1-to-v2 migration.
6. Extract the shared Rust layout service.
7. Implement `terrazzo layout inspect` and `terrazzo layout apply` for the application-closed path.
8. Add the local request/response socket and live-canvas update path.
9. Add higher-level arrange, align, distribute, and resize commands as clients of batch apply.
10. Add JSON Canvas export, then import after the mapping and collision rules are specified.

The first six steps improve ordinary application safety even if no agent uses the CLI. The socket is not a prerequisite for documenting or stabilizing the file format.

---

## 8. When to revisit

- A directory regularly exceeds 10,000 rendered items and whole-file parsing or serialization becomes a measured bottleneck.
- Multiple devices or users need concurrent writes to the same canvas. Replace last-writer conflict rejection with an operation log, merge model, or CRDT only after defining the required collaboration semantics.
- Named alternate views become a daily workflow. Introduce placement identity separately from durable file identity.
- JSON Canvas adds standard identity, rotation, revision, or directory-projection semantics that materially reduce Terrazzo-specific storage.
- Extension data becomes large or executable. Move that feature into a separate bounded store rather than weakening the layout contract.
