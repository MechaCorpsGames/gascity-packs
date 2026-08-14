# GAM CLI Reference

GAM (Google Apps Manager) is the standard CLI for Google Workspace administration.

## Installation

```bash
# macOS/Linux — install GAMADV-XTD3 (the actively maintained fork)
bash <(curl -s -S -L https://raw.githubusercontent.com/taers232c/GAMADV-XTD3/master/src/gam-install.sh)

# Or via Homebrew
brew install gam
```

After install, run `gam setup` to create a Google Cloud project and authorize.

## Setup Flow

1. `gam setup` — creates GCP project, enables Admin SDK, creates OAuth credentials
2. Authorize as a Workspace super admin when prompted
3. GAM stores credentials in `~/.gam/` (or `$GAMCFGDIR`)

## Common Commands

### Users
```bash
gam print users                           # List all users
gam create user chris@gascity.ai firstname Chris lastname Sells password '<pass>' changepassword on
gam update user chris@gascity.ai admin on  # Make super admin
gam info user chris@gascity.ai             # User details
gam delete user old@gascity.ai             # Delete user
```

### Groups
```bash
gam print groups                           # List groups
gam create group team@gascity.ai name "Team"
gam update group team@gascity.ai add member chris@gascity.ai
```

### DKIM
```bash
gam create dkimkey gascity.ai              # Generate DKIM key pair (shows DNS record to add)
gam update dkimkey gascity.ai activate     # Activate after DNS propagation
gam info dkimkey gascity.ai                # Check DKIM status
```

### Domain & Email Settings
```bash
gam print domains                          # List domains
gam info domain gascity.ai                 # Domain details
gam print aliases                          # Email aliases
gam create alias info@gascity.ai user chris@gascity.ai
```

### Email Routing
```bash
gam print smtpmsa                          # SMTP relay settings
gam print inboundssosettings               # Inbound gateway settings
```

### Org Units
```bash
gam print orgs                             # List org units
gam create org "Engineering"               # Create org unit
gam update user chris@gascity.ai org "Engineering"
```

### Reports & Audit
```bash
gam report login user chris@gascity.ai     # Login activity
gam report admin                           # Admin audit log
gam print tokens user chris@gascity.ai     # OAuth tokens granted
```

## Scripting with GAM

GAM commands are scriptable. Example batch user creation:

```bash
# users.csv: email,firstname,lastname
gam csv users.csv gam create user ~email firstname ~firstname lastname ~lastname password 'TempPass123!' changepassword on
```

## Troubleshooting

- `gam check serviceaccount` — verify service account permissions
- `gam version` — check installed version
- `gam info customer` — verify Workspace connection
- Add `debug` to any command for verbose output: `gam debug info user chris@gascity.ai`
