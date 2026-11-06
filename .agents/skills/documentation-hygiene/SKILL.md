---
name: documentation-hygiene
description: Review information before writing or updating project documentation, plans, reports, README files, or repository artifacts. Prevent disclosure of machine-specific, environment-specific, private, or operational information, especially in public repositories.
---

# Documentation Hygiene

## Core principle

Not everything discovered during development belongs in project documentation.

Prioritize project relevance, reproducibility, and information safety over completeness.

Treat all information as potentially sensitive until it has been classified.

## Before writing or updating any file

Classify every piece of information into:

1. **Project information** — architecture, implementation decisions, requirements, technical constraints and reusable setup instructions.
2. **Session information** — temporary debugging observations, current development state and troubleshooting results.
3. **Environment-specific information** — local processes, running containers, machine configuration, local ports, filesystem paths, usernames, hostnames and internal infrastructure.
4. **Sensitive information** — credentials, tokens, secrets, private URLs, internal endpoints and private operational details.

## Documentation rules

- Document project information when relevant.
- Keep session information in the current working context unless it is necessary for a future task.
- Never write machine-specific or environment-specific observations into shared project files.
- Never expose actual credentials, tokens, secret values or private connection strings.
- Do not copy terminal output, process listings, Docker container names, environment variables or local configuration into documentation without reviewing them.
- Do not assume that information is safe merely because it is not a password or secret.
- Do not document incidental debugging discoveries as permanent project constraints.
- When a local issue reveals a genuine project-level problem, document the general problem and reproducible solution without exposing the local environment.

## Public repository awareness

Assume that every tracked file in the repository may become publicly accessible.

Apply stricter scrutiny to:
- README.md
- Plan.md / plans
- AGENTS.md
- Architecture documentation
- Troubleshooting guides
- Examples and configuration templates
- Commit messages and pull request descriptions

## Before committing documentation changes

Perform a disclosure review:

1. Identify machine-specific details.
2. Identify internal infrastructure references.
3. Identify local paths, ports, process names and container names.
4. Identify environment variables and connection strings.
5. Check whether each detail is necessary for another developer to understand or reproduce the project.
6. Replace incidental details with generic, reusable explanations or remove them.

## Approval policy

- Do not ask for approval for ordinary, sanitized project documentation.
- If information might be useful but its disclosure safety is uncertain, ask the user.
- Ask the user before including potentially sensitive operational information.
- Never interpret permission to write a file as permission to disclose everything discovered during development.

## Final principle

Document the project, not the developer's machine.

When in doubt, omit the detail and explain the omission to the user.