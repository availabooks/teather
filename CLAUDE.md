# Teather

Read `README.md` first for how Teather works, and `public/integrate.md` for the API that sites use.

## Commands

- `npm test`: unit tests
- `npm run typecheck`
- `npm run db:migrate:local`, then `npx wrangler pages dev --port 8788` for local development (`.dev.vars` is described in
  the README)
- Deploy: `npx wrangler pages deploy --project-name teather`

## Rules

- Keep `public/teather.js` and `public/integrate.md` in step. Live sites load `/v1/teather.js`, so changes to it must be
  backward compatible.
- Student data belongs in the student's Drive, never in D1. D1 holds only accounts, encrypted tokens, hashed session tokens
  and cached Drive ids.
- When a site's text in `src/sites.ts` changes, bump its `version` so students' READMEs are rewritten. Any new use of a
  student's data, such as an instructor reading it, must be explained there before it ships.

## Sites that use Teather

**AvailaBooks** is the main one. Its workspace is `F:/code/availabooks-platform/availabooks`: the platform app is in `app/`
and the reader-side synced-storage script is in `tools/system-files/dev/synced-storage.js`. Both are separate Git repos.
`.claude/settings.json` here adds that workspace as an extra working directory. Start cross-repo sessions from the
AvailaBooks workspace. Its `CLAUDE.md` maps the repos and describes how to deploy them in order.

## Ongoing design

`docs/signed-scores.md`: scores that students keep in their own Drive but can't forge, and that instructors can gather
for a course.
