# Deploying the chore board to Firebase Hosting

Why: Firebase Hosting serves the site from the same domain as Google sign-in
(`household-chores-73e50.web.app`), which makes sign-in work everywhere —
including iPhone full-screen "app mode" from a home-screen icon. GitHub Pages
keeps working too; this just adds a second, better home for the app.

You only need a terminal, Node.js 18+, and about five minutes.

## One-time setup

```bash
# 1. Get the repo on your machine (skip if you already have it)
git clone https://github.com/Jason-Peralta/household-chores.git
cd household-chores

# 2. Install the Firebase CLI
npm install -g firebase-tools

# 3. Sign in with the SAME Google account that owns the Firebase project
#    (jperalta3197@gmail.com). A browser window opens; approve it.
firebase login

# 4. Deploy. firebase.json + .firebaserc are already in the repo,
#    so there's nothing to configure.
firebase deploy --only hosting
```

When it finishes it prints:

```
✔  Deploy complete!
Hosting URL: https://household-chores-73e50.web.app
```

Open that URL on your phone, sign in, and use **Add to Home Screen** — it now
opens full-screen and sign-in works inside it. Share that URL with Stacy and
Fabian instead of the github.io one.

## Auto-deploy on every change (recommended, optional)

So that future edits (from me or you) go live automatically when `index.html`
changes on GitHub — no more `firebase deploy` by hand:

```bash
firebase init hosting:github
```

Answer the prompts like this:

| Prompt | Answer |
|---|---|
| For which GitHub repository would you like to set up a workflow? | `Jason-Peralta/household-chores` |
| Set up the workflow to run a build script before every deploy? | **No** |
| Set up automatic deployment to your site's live channel when a PR is merged? | **Yes** |
| What is the name of the GitHub branch associated with your site's live channel? | `main` |

It creates a service-account secret in the GitHub repo for you and writes two
workflow files under `.github/workflows/`. Then push them:

```bash
git add .github firebase.json .firebaserc
git commit -m "Firebase Hosting auto-deploy"
git push
```

From then on, every commit to `main` deploys to
`https://household-chores-73e50.web.app` within a minute or two (watch the
Actions tab on GitHub). PRs get their own preview URL too.

## Later: custom domain (optional)

Firebase console → Hosting → **Add custom domain**, follow the DNS steps, and
then add that domain under Authentication → Settings → Authorized domains. The
app already picks up the right auth domain automatically.

## Troubleshooting

* `Error: HTTP Error: 403, The caller does not have permission` → you're
  logged into the wrong Google account. `firebase logout` then `firebase login`.
* `Error: No project active` → run from the repo folder (where `.firebaserc`
  lives), or `firebase use household-chores-73e50`.
* Sign-in says *unauthorized domain* → Firebase console → Authentication →
  Settings → Authorized domains must include the domain you're on
  (`household-chores-73e50.web.app` is there by default).
