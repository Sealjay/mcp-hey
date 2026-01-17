---
applyTo: "**/docs/adr/*.md"
---

# ADR Processing Guidelines for AI Agents

## Project coding standards for ADRs

Apply the [general coding guidelines](./general-coding.instructions.md) to all code.

## Core Principles

1. ADRs are immutable once accepted - create new ADRs to supersede old ones
2. Each ADR must focus on a single architectural decision
3. Write in clear, concise US English
4. Maintain consistent technical terminology across all ADRs
5. Never modify the ADR template

## File Management

- Use the format: `NNNN-title-with-hyphens.md`
- NNNN must be the next sequential number from the index
- Title must be brief but descriptive
- Use lowercase letters and hyphens only
- Never delete or modify accepted ADRs

## Required Operations

1. When creating a new ADR:

   - Copy from template.md without modifications
   - Add entry to index.md table
   - Create relative links to related ADRs
   - Set initial status as "proposed"
   - Use current date for the Date field

2. When updating ADR status:

   - Only modify the Status field
   - Update the date field with current date
   - If superseded, add link to new ADR
   - Never modify the content of accepted ADRs

3. When linking ADRs:
   - Use relative links only
   - Update both source and target ADRs
   - Use standard relationship types: "Supersedes", "Refined by", "Related to"

## Content Requirements

1. Context section must include:

   - Clear problem statement
   - Technical or system constraints
   - Business or technical drivers from codebase
   - Current state analysis

2. Decision Drivers must include:

   - Technical requirements from codebase
   - System constraints from architecture
   - Performance, security, or scaling factors
   - Quantifiable metrics where possible

3. Options section must include:

   - Minimum of two viable options
   - "Do nothing" option if applicable
   - Pros and cons based on codebase analysis
   - Technical feasibility assessment

4. Consequences section must include:
   - Technical impact analysis
   - System architecture effects
   - Performance implications
   - Codebase modification requirements

## Validation Process

1. Pre-commit checks:

   - Verify Markdown syntax
   - Validate all relative links
   - Confirm index.md consistency
   - Check date format compliance

2. Content validation:

   - Verify technical accuracy against codebase
   - Ensure all sections are complete
   - Validate architectural consistency
   - Check for technical terminology consistency

3. Post-acceptance tasks:
   - Update status field
   - Update index.md
   - Update related ADR links
   - Verify all file paths and references
