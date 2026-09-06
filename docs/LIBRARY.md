# The library

What a project's numbers rest on: the sources, the claims that cite them, and the checks that hold
those claims. The Desk reads a project's library as the project keeps it and adds one file, the
candidates waiting to be read. The same shelves can be shared between projects.

## What the desk reads

`desk.json`:

```jsonc
"library": {
  "sources": "docs/science/sources.json",        // the shelf: one entry per source
  "papers": "docs/science/papers",               // <slug>.pdf, usually gitignored and re-fetchable
  "text": "docs/science/.textcache",             // <slug>.txt, the extracted text the search reads
  "claims": "docs/claims.json",                  // the claims index, if the project has one
  "contradictions": "docs/science/contradictions.md",   // its ## headings are listed
  "candidates": "docs/science/candidates.json",  // written by the desk
  "fetch":  ["python", "Tools/science/fetch_papers.py"],        // run after an accept
  "render": ["python", "Tools/science/render_bibliography.py"], // run after an accept
  "shared": ["F:/nest/library"]                  // other shelves, read the same way
}
```

A source entry (Basin's shape, which the desk understands; extra fields are kept and shown):

```json
{ "slug": "cratering_melosh_impact-cratering-ch6", "domain": "cratering", "year": 1989,
  "authors": ["H. Jay Melosh"], "title": "Impact Cratering: A Geologic Process, ch. 6",
  "venue": "Oxford University Press", "url": "https://…", "licence": "copyright, do not redistribute",
  "canonical": true, "settles": "Crater morphology…", "supplies": ["…"], "target": "Tools/baker" }
```

A claim (the shape `claims.py` writes): `body`, `file`, `line`, `section` (Settled / Speculated /
Weak points), `claim`, `principle`, `cites_source`, `checks[{kind, ok, note}]`.

**Linking.** Ledgers cite in prose, so the desk links a claim to a source when the ledger line
names the first author's surname and the year, or the slug. Items are linked the same way. It is
best effort and the view says so.

## The Library view

- **Sources**: by domain, with what each settles, who cites it, which items read it, whether the
  PDF and its text are on disk. Click for the card: settles, supplies, claims citing it with
  their check verdicts, items reading it, open the PDF or the text.
- **Claims**: every claim with its section, principle, sources and checks. "Only Settled claims
  that cite nothing" is the list that should be empty.
- **Candidates**: proposed sources with the three sentences the selection process requires, and
  Accept / Reject. Accept appends to `sources.json` (with the decision and the three sentences
  under `accepted`) and runs the fetch and render hooks.
- **Search**: titles, authors, what a source settles, and the full text cache, with snippets.

## The research action

A theme comes in ("what limits crop yield in regolith"); a candidate list comes out. The agent
does the reading; the desk records the result and holds the gate. Every candidate must carry:

1. **Why** — what it would settle or supply for this project, in one sentence.
2. **Recency** — what has been published since, and whether this is still the reference. A 2011
   paper is fine when the field has not moved; say so.
3. **Credentials** — the authors' affiliation and prior work in the field, and the venue's
   standing, with how that was verified (the paper's own title page, the journal, an author page).
4. **Contradictions** — which papers already on the shelf it agrees or disagrees with, and where.
   This is the `contradictions.md` discipline as a step: the shelf was audited against itself
   before anything was made canonical, and every new paper joins that audit.

`desk_library_propose` refuses a candidate missing any of the three checks. Nothing becomes a
source automatically: a person reads it and clicks Accept, or an agent records the user's words
with `attested_by_user`. That is the same boundary the tracker draws around `YOURS`.

## Over MCP

| tool | what |
|---|---|
| `desk_library_sources` | the shelf, with links and file presence |
| `desk_library_source` | one source in full, with the first 3,000 characters of its text |
| `desk_library_claims` | the claims, optionally only Settled-without-source or only failing checks |
| `desk_library_search` | metadata and full-text search with snippets |
| `desk_library_propose` | record a candidate (all three checks required) |
| `desk_library_decide` | accept or reject; accept needs `attested_by_user` and the user's words |

## Sharing shelves

A shared shelf is a folder with `sources.json`, `papers/` and `text/` in it. List it under
`shared` in any project's `desk.json` and its sources appear beside the project's, marked with
their origin. The shelf stays where it is; nothing is copied. PDFs stay out of git wherever they
are; `sources.json` is what makes a shelf reproducible.
