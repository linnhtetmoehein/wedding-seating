# Wedding Seating Planner (v0.3 – shared plan, works on phones)

A small web app to seat wedding guests on the ballroom floor plan (15 round tables, 10 chairs each: VIP 1, VIP 2, 1–3, 5–13, 15).

**New in v0.2:** one **shared plan** that several people can edit at the same time from a web link, protected by an **edit passcode**.

## Opening the shared plan
1. Open the link (the GitHub Pages address once it's set up, or run it on your PC, see below).
2. Type **your name** (others will see who's online) and the **edit passcode**, then click *Open the plan*.
   - The passcode is remembered on that device. *Sign out* (top bar) makes it forget.
   - If you see "passcode has not been set up yet", the passcode still needs to be set (see *For the admin*).
3. Edit as normal. The top bar shows:
   - **✓ All changes saved**, or **Saving…** while it saves
   - **Also here: …**: who else has the plan open (the dot is green when live updates are on)
   - **⚠ Offline**: your changes stay on screen and save by themselves when the internet is back

When someone else makes a change, it shows up on your screen within a second or two (at most about 15 seconds).

### What happens if two people edit at the same time?
Nothing gets lost. Every change (seat a guest, move a table, rename…) is saved as a small step. If someone else saved first, the app takes the newest plan, re-applies your steps on top and saves again.
- If you both drop different guests on the **same empty chair**, the second one goes to the next free chair at that table, so nobody is kicked off.
- "Fill empty seats from list" never takes guests who were just seated by someone else.
- *Reset all* and *Clear seats* affect **everyone**, so the app asks you first.
- *Undo* is only available in offline mode, because in the shared plan it could undo someone else's work.

## On a phone
Open the same link on your phone (iPhone Safari or Android Chrome) and enter your name and the passcode. Tip: use "Add to Home Screen" so it opens like an app.
The screen has three tabs at the bottom: **Plan**, **Guests** and **Table**.
- **Easiest way to seat someone:** tap a table on the plan (or in the Table tab). Its 10 seats are listed. Tap an empty seat, then tap a guest in the list that pops up (you can search).
- **From the guest list:** in **Guests**, tap a name. A yellow bar says "Seating: name – tap a chair". Then tap a chair on the plan. *Cancel* stops it.
- **Tap a chair with someone on it** to see their name, then choose **Move to another chair** (then tap the new chair; a taken chair swaps) or **Unseat**.
- In the Table tab, each seated guest has **Move** and **×** (unseat) buttons.
- **Zoom:** use the + / − buttons, or pinch with two fingers. Drag with one finger to look around.
- **☰ menu** (top right) has Add names, Import Excel/CSV, Export Excel, + Table, Move tables, Clear seats and Reset all.
- Excel import and export work on phones too. The exported file goes to your Downloads (on iPhone: the Files app).

## How to use (computer)
1. **Add guests**: paste names (one per line) and click *Add names*, or click *Import Excel / CSV…*.
   - The app reads the first sheet. It uses the column called **Name** (or the first column if there's no header).
   - An optional **Group** or **Side** column shows as a tag and colours the chair.
   - Names already in the list are skipped.
2. **Seat people**: drag a name onto a chair. You can also click a name, then click a chair. Dropping on a table's centre uses the first free chair.
3. **Move people**: drag from chair to chair. A taken chair means the two guests swap.
4. **Unseat**: drag the guest back to the list, double-click the chair, or press × in the table panel.
5. **Read names**: hover over a chair, or click a table to see its 10 seats on the right. Zoom to 150% or more to show first names on the plan.
6. **Tables**: click a table to rename it, make it VIP or normal, clear it, remove it, or fill it from the list (search first to fill from one group). *+ Table* adds one, and *Move tables* lets you drag them.
7. **Export Excel** downloads Seating (Name, Table, Seat, Group), Unseated and Tables sheets. Importing that file again puts everyone back in the same seats, so it's also your backup.

## Run it on your Windows PC
Double-click **`Start Wedding Seating.bat`**. The first time, it installs packages (takes a minute), then your browser opens the app. Keep the black window open while you use it.
Running it on your PC uses the **same shared plan** as the web link.
By hand: `npm.cmd install`, then `npm.cmd run dev`.

## Other modes
- **Offline (this computer only):** add `?local` to the address (or click *Use offline on this computer only* on the passcode screen). It saves in this browser only, like v0.1.
- **Demo:** add `?demo` to the address. It loads 130 made-up names and **never saves**.
- **Sample list:** `samples/sample-guest-list.xlsx`

## For the admin (Linn / Cody)
- **Database:** Supabase project `wedding-seating` (https://ebyvnlflkxidrqswalwt.supabase.co). Settings are in `src/config.js`. The key there is the public "publishable" key, which is safe to publish.
- **Security:** the guest list is stored in a table that the public key cannot read or write. The app can only use two database functions, and both check the passcode first (stored as a bcrypt hash). After 20 wrong passcodes in 10 minutes, it stops accepting tries for a while.
- **Set or change the passcode** (Supabase dashboard, SQL Editor). Everyone has to enter the new one:
  ```sql
  select public.set_passcode('your-passcode-here');   -- at least 6 characters
  select public.set_passcode(null);                   -- switch editing off for everyone
  ```
- **Database setup** is in `supabase/migrations/` (already applied).
- **Publishing (GitHub Pages):** push this folder to a GitHub repo, then in the repo go to *Settings → Pages → Source: GitHub Actions*. `.github/workflows/deploy.yml` builds and publishes on every push to `main`.
- **Tests:** `npm.cmd test`. To check against the real database: `set WS_PASSCODE=...` then `npm.cmd run e2e` (it writes test data to the plan and then **clears the plan**, so only use it before real names are in).
