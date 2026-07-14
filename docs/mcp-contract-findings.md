# MCP Contract Findings

Inspection date: 2026-07-14

The MCP repository was inspected read-only. No Dropbox, deployment, or MCP source changes were made.

## Usable read operations

- `search_dropbox_filenames({ query })`
- `read_dropbox_text_file({ path })`
- `list_dropbox_revisions({ path })`

## Gaps against the voice application requirements

1. Folder and search results return name, path, and type but not Dropbox file ID or revision ID.
2. Text reads accept a path and return only text. They cannot request or prove a particular historical revision.
3. The Registry schema and location are not defined in the MCP repository.
4. There is no Reader Copy-specific resolver.
5. Writes support UTF-8 text only, not audio.
6. Remote HTTP authentication is OAuth by default, with an explicitly enabled static-key fallback intended only for controlled diagnostics.

## Safe initial adapter

The first reader slice uses only the three read operations above. It cannot call create, update, move, delete, or restore tools.

For strict version pinning, a later independently approved MCP change should add a read operation that accepts an immutable revision and returns file ID, revision ID, path, content, and content hash in one consistent operation.
