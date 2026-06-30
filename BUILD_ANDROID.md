# Building the Android app (.aab) and shipping to Google Play

Everything is scaffolded under `mobile/` — Capacitor wraps the web app as a native Android app (`applicationId app.dibs.mobile`). You only need to build, sign, and upload.

## Prerequisites (on your machine)
- **Android Studio** (latest) + **JDK 17** (bundled with Android Studio).
- **Node 18+**.
- A **Google Play Developer account** ($25 one-time).
- Your backend deployed over HTTPS (see `DEPLOY.md`).

## 1. Build the web bundle with your live API
```bash
cd mobile
npm install
DIBS_API_BASE=https://dibs-api.onrender.com npm run sync
```
`npm run sync` builds `www/` (baking in the HTTPS url) and runs `cap sync` to copy it into the Android project. **Re-run this every time you change the frontend or the API url.**

## 2. Open in Android Studio
```bash
npx cap open android
```
Let Gradle finish syncing. To try it on a device/emulator: **Run ▸ app**. Confirm login, the board, posting (gallery photos), chat, and a test payment all work against your live backend.

## 3. App identity & version
- **App id** `app.dibs.mobile` and name "dibs" are set. To change the id, edit `appId` in `mobile/capacitor.config.ts`, delete `mobile/android`, and re-run `npm run android:add`.
- **Version** lives in `mobile/android/app/build.gradle` (`versionCode` / `versionName`). Bump `versionCode` by 1 for **every** upload to Play.
- **Icon**: in Android Studio right-click `app/res` ▸ New ▸ Image Asset ▸ Launcher Icons, or drop a 512×512 icon and generate.

## 4. Create a signing key (once)
```bash
keytool -genkey -v -keystore dibs-release.jks \
  -alias dibs -keyalg RSA -keysize 2048 -validity 9125
```
Keep `dibs-release.jks` and its passwords safe and **out of git** (already gitignored). Create `mobile/android/keystore.properties`:
```
storeFile=/absolute/path/dibs-release.jks
storePassword=********
keyAlias=dibs
keyPassword=********
```
Then in `mobile/android/app/build.gradle`, add a `signingConfigs.release` that reads `keystore.properties` and reference it from `buildTypes.release`. (Android Studio's **Build ▸ Generate Signed Bundle** wizard can also do this for you and remember it.)

## 5. Build the App Bundle (.aab)
Easiest: **Build ▸ Generate Signed App Bundle / APK ▸ Android App Bundle**, pick your keystore, choose **release**. Output:
```
mobile/android/app/release/app-release.aab
```
Or CLI:
```bash
cd mobile/android && ./gradlew bundleRelease
```

## 6. Google Play Console
1. **Create app** → name "dibs", type App, free.
2. **Internal testing** → Create release → upload the `.aab` → add your own email as a tester → share the opt-in link → install from Play → **test login, listings, photos, chat, payments** end-to-end.
3. Fill the required **store listing** (icon, short/full description, screenshots, feature graphic), **content rating** questionnaire, **data safety** form (declare: email, photos, chat messages, payment handled by Stripe), **privacy policy URL**, and **target audience** (18+ avoids extra child-safety rules).
4. **Closed testing** → wider tester list (Google often wants ~12 testers for 14 days before production for new personal accounts).
5. **Production** → submit for review.

## Notes that save a rejection
- **Reviewer access**: Play reviewers must be able to sign in. Since signup is `.edu`-gated, give them a working `.edu` email + the login code in the "App access" → "Login credentials" section, or stand up a reviewer account. Without this, review fails.
- **Payments**: physical peer-to-peer goods may use Stripe (external payments) on Google Play — you are **not** required to use Google Play Billing for these. Don't sell digital content this way.
- **Gallery vs camera**: selecting existing photos works out of the box. Live camera capture from the `<input>` may need the CAMERA permission + a FileProvider; add only if you want in-app capture.
- **Account deletion**: Google requires an in-app (or clearly linked) way to delete an account. Add a delete endpoint + button before production.
