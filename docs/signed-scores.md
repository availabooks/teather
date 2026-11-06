# Signed scores (design notes, not built yet)

Goal: students keep their own score records in their Teather folder, and an instructor can trust that the records
weren't changed and can gather them for a whole course.

## Decisions so far

- **No blockchain.** There's a trusted party already (the instructor or the platform), so signatures do the job. A public
  ledger would create privacy problems (FERPA) and add cost without stopping the attack that matters.
- **Every score is a signed record.** Ed25519 (WebCrypto) over a canonical form of the record. Students can read the file
  and move it, but any edit breaks the signature. Anyone with the public key can check it offline.
- **Records are chained.** Each record holds the hash of the one before it, and the signer gives it an attempt or sequence
  number, so deleted or reordered records can be spotted. For required work, a missing record counts as missing, never
  as a pass.
- **Records are tied to the student.** The student's id (and the course id) are inside the signed data, so records
  can't be swapped between students.
- **The signing key never reaches the browser.** Any key or answer key in page JavaScript can be extracted. Grading and
  signing happen on the server (an AvailaBooks Worker route or a small Worker of its own). Scores calculated in the
  browser can only be stored as unsigned, "self-reported" practice.

Draft record:

```json
{
  "v": 1,
  "student": "<platform user id>",
  "course": "<course id>",
  "item": "ch3-quiz",
  "score": 8, "max": 10,
  "attempt": 2,
  "ts": "2026-11-06T15:02:11Z",
  "prev": "<sha256 of previous record>",
  "kid": "<signing key id>",
  "sig": "<ed25519 signature over all fields above>"
}
```

## Gathering scores for a course

The Teather server can technically read any connected student's folder, because it holds offline refresh tokens and has
the `drive.file` scope. Doing that for an instructor needs:

1. **A roster.** AvailaBooks already has courses, rosters and staff (`app/src/courses/`, `voshi_course_staff`). Use those
   rather than adding classes to Teather.
2. **Consent.** Students currently agree only to storage. Sharing must be opt in (for example when they join a course),
   cover a single file such as `<site>/scores.json`, be explained in the site text in `src/sites.ts` (bump `version`), and be
   possible to withdraw.
3. **Instructor access.** An endpoint that only course staff can call. It reads each consenting student's scores file,
   checks every signature and the chain, and flags any record that fails instead of counting it.

## Open questions

- **Pull or push?** Pull: the server reads students' files when the instructor asks (a live view, but Teather reads
  student data on someone else's behalf). Push: the student presses "Submit to course" and sends the signed records (an
  easier privacy story, but the instructor sees only what was submitted).
- **Where does the signing key live?** Alongside `app/src/abby/sign.ts` (which uses HMAC today) in AvailaBooks, or in
  Teather? Ed25519 lets verification be public, which HMAC can't.
- **How does this relate to `abby_grades` and `grade-export.ts`?** AvailaBooks already keeps grades on the server. Is the
  student-held copy a portable receipt alongside those, or the record that counts, for books used without a platform
  account?
