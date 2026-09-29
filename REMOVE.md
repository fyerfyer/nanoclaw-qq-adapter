# Uninstall NanoClaw OneBot Napcat Adapter

## Quick uninstall (recommended)

From the adapter repository, run the removal script against your NanoClaw host:

```bash
tsx scripts/remove-onebot-napcat.ts --host-dir <NANOCLAW_HOST_ROOT>
```

The script will:

1. Delete `<host>/src/channels/onebot-napcat/`
2. Remove `import './onebot-napcat.js';` from `<host>/src/channels/index.ts`
3. Leave shared `ws` dependencies in `<host>/package.json`; remove them manually only after checking that no other channel uses them.
4. Run `pnpm install` in the host directory

Your `.env` Napcat variables are left untouched so you don't lose configuration; remove them manually if desired.

## Manual uninstall

If you prefer to revert the changes by hand:

1. Delete the adapter directory:

   ```bash
   rm -rf <NANOCLAW_HOST_ROOT>/src/channels/onebot-napcat
   ```

2. Remove the barrel registration from `<NANOCLAW_HOST_ROOT>/src/channels/index.ts`:

   ```ts
   import './onebot-napcat.js';
   ```

3. The removal script intentionally leaves `ws` and `@types/ws` in `package.json`, because other channels may share them. Remove them manually only after checking the host dependency graph.

4. Run `pnpm install` in the host directory.

5. Optional: remove the Napcat environment variables from `<NANOCLAW_HOST_ROOT>/.env`.

## What is NOT removed

- NapCat Docker containers or volumes (manage them with `docker compose down`)
- QQ account sessions or credentials stored in NapCat
- Any wiring rows in NanoClaw's database (remove via `/manage-channels` or `ncl wirings`)
