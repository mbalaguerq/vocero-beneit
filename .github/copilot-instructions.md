# Context del CRM Vocero Beneït

- Aquest repositori privat (`https://github.com/mbalaguerq/vocero-crm-beneit.git`) és el CRM Next.js.
- La font local és `C:\laragon\www\App Beneit Agenda\vocero-beneit`.
- El CRM de proves es desplega a `https://vocero.instalabeneit.es` via cPanel; no s’ha de desplegar a Render.
- `mbalaguerq/vocero-beneit` i el servei Render `vocero-nea-proves` són Nea, un projecte separat.
- No mostrar secrets ni valors d’entorn. No tocar producció ni l’agenda de producció.
- Desenvolupar i validar sempre en local amb `pnpm lint`, `pnpm typecheck`, `pnpm test` i `pnpm build` abans de preparar el desplegament.
- La base de dades i el procediment Node.js/cPanel del CRM de proves són **NO VERIFICATS** fins a inspeccionar la configuració real del hosting.
