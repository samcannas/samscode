# Agent Catalog Imports

This catalog is a curated import from [`msitarzewski/agency-agents`](https://github.com/msitarzewski/agency-agents).

## Category mapping

- `engineering/` -> local `agents/catalog/engineering/`
- `design/` -> local `agents/catalog/design/`
- `paid-media/` -> local `agents/catalog/paid-media/`
- `sales/` -> local `agents/catalog/sales/`
- `marketing/` -> local `agents/catalog/marketing/`
- `product/` -> local `agents/catalog/product/`
- `project-management/` -> local `agents/catalog/project-management/`
- `testing/` -> local `agents/catalog/testing/`
- `support/` -> local `agents/catalog/support/`
- `specialized/` -> local `agents/catalog/specialized/`

## Notes

- Local filenames are normalized to clean slugs without the source repo category prefixes.
- Imported files keep the source markdown body plus useful source frontmatter, with local `id`, `author`, and `source_path` metadata added where needed.
- Only the requested subset of agency-agents is kept in this catalog.
- The upstream MIT notice for these imports is retained in `NOTICE.md` and `third_party_licenses/msitarzewski-agency-agents.MIT.txt`.

## Add or update imports

1. Find the exact source markdown file in `msitarzewski/agency-agents`.
2. Copy its markdown body and useful frontmatter into the matching local category folder under `agents/catalog/`.
3. Normalize the local filename to the agent slug without the source category prefix.
4. Ensure frontmatter includes local `id`, `author: msitarzewski/agency-agents`, and `source_path: <repo-relative path>`.
5. Remove local catalog files that are no longer part of the supported import set.
