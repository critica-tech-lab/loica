### Claim the admin account

**The first account to sign up becomes the administrator.** Open
`https://$CLOUDRON-APP-FQDN/signup` and register now, before anyone else can.

### Single sign-on

If you attached the OIDC addon, one more step is needed: sign in as the
administrator, open **Admin → Extensions**, and enable **oidc**. The provider
appears as a button on the login page — the addon's credentials are already
wired up, nothing to paste.

To make it the only way in, set `DISABLE_LOCAL_LOGIN=true` in the app's
environment. To keep password login but stop new self-service signups, set
`REGISTRATION_OPEN=false` instead.

### Email

With the sendmail addon attached, invitations and password resets are sent
through Cloudron's mail relay. Without it, Loica writes outbound mail to the log
instead — the app works, but those messages have to be relayed by hand.

### Data and backups

Everything mutable lives in `/app/data`: the SQLite database, uploads, and any
drop-in plugins. Cloudron's backups cover it, and the database is snapshotted
consistently rather than copied while open.
