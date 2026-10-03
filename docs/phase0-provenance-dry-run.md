# Phase-0 provenance pilot dry-run

The complete source-record flow was exercised with `test/fixtures/synthetic-provenance-package.json`. This is **synthetic metadata only**: it does not claim that a person consented, that a camera recording occurred, or that media exists. No private media or release was added.

The offline test performs normalization, structural validation, deterministic match-level splitting, state persistence, JSON export, and JSON re-import with the manual label intact. The fixture deliberately records `mediaIncluded: false` and `intendedShareability: private`; therefore the shareable/training-source gate remains blocked even though the project owns the synthetic fixture metadata. `trainingAuthorized` is always false.

This is evidence that the software path works, not evidence of a real capture. Follow [`capture-and-consent.md`](capture-and-consent.md) for the first captain-owned video.
