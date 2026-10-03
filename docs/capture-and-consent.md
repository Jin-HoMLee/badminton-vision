# Rights-first capture and consent protocol

This protocol is for club/training footage recorded by the captain or project. It is a practical recordkeeping template, **not legal advice**. Local privacy, publicity, employment, venue, safeguarding, and minor-consent rules may require changes or professional review.

## Before recording

1. Confirm the camera operator/project will own or control the recording and that the venue permits recording and the intended reuse.
2. Avoid spectators and bystanders where practical. Do not record a minor without the authorization required in the applicable jurisdiction and club.
3. Give every identifiable player the plain-language project description and the release in [`player-consent-template.md`](player-consent-template.md). Allow questions and a real choice without pressure.
4. Assign each signed release a private evidence ID. Store the release outside the public repository; only that ID belongs in source metadata.
5. Choose one stable match/session key before recording. Every video segment from that match uses this key, so it receives one deterministic train/validation/test assignment.

## At capture

- Use a project-controlled device and record the date, venue category (not a private address), camera/operator, match key, and file checksum in a private capture log.
- Do not capture private conversations, changing rooms, score sheets with personal details, or unrelated activity.
- If an unconsented identifiable person enters frame, pause/reframe or quarantine the affected segment.

## Import and review

1. Keep the original media private. Do not commit footage or signed releases to this repository.
2. Open **Manual labeling → Source rights & provenance** and enter the owner, `owner-recorded` basis, `self-recorded` capture method, capture date, contributor, consent status and private release ID, annotation license, intended shareability, and match key.
3. Mark rights `cleared` only after ownership/venue checks and all identifiable-player consent evidence are complete. Mark `mediaIncluded` only for an intentionally assembled private/release package.
4. Review the displayed source gate and deterministic split. Export **JSON** to carry labels and provenance together; CSV remains labels-only and cannot grant or change rights.
5. Before any public release, verify the dataset card, remove private paths/details, and independently review every source. Source-gate eligibility is not authorization to train.

## First real-video run checklist

No captain-owned footage was present in the authorized project inputs for the Phase-0 pilot. For the first real run, the captain must provide, through an approved private channel:

- one captain/project-owned video (not BWF/broadcast footage or a public URL),
- the stable match/session key and recording date,
- media owner and contributor/operator identification,
- confirmation of venue permission where applicable,
- a private evidence ID for each identifiable player's completed release,
- the intended media and annotation licenses/shareability,
- confirmation that no private media or signed release should be committed publicly.

Stop the import if any item is missing; retain `rightsStatus: not-cleared`, `mediaIncluded: false`, and a non-shareable intent.
