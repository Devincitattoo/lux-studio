# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in lux-studio, please **do not** open a public GitHub issue. Instead:

1. Email security concerns to the maintainers directly
2. Include a clear description of the vulnerability
3. Provide steps to reproduce if possible
4. Allow reasonable time for a fix before public disclosure

## Security Practices

- All production secrets are managed via GitHub Environments
- Sensitive credentials (API keys, tokens) are never committed to the repository
- Use `.env.example` as a template for required environment variables
- Secrets are rotated regularly
- All external API calls use HTTPS
- Input validation is performed on all user-provided data

## Dependency Security

- Dependabot automatically checks for vulnerable dependencies
- Security patches are applied promptly
- Regular audits are performed using `npm audit`
- Trivy scans are run on every commit

## Integration Security

- Stripe: PCI compliant, uses official SDK
- Supabase: Row-level security policies enforced
- SendGrid: Verified sender addresses required
- Twilio: Account SID and Auth Token protected as secrets
- Apify: API tokens stored securely in environment variables
- Higgsfield: API keys protected as secrets

## Responsible Disclosure

We take security seriously and appreciate the community's help in identifying and fixing vulnerabilities responsibly.
