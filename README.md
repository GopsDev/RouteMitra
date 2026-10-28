# RouteMitra

Field sales companion for ERPNext: customer maps, beat plans and GPS-verified shop visits.

| Folder | What it is |
| --- | --- |
| [`backend/`](backend) | Frappe app `routemitra` for ERPNext v16: Beat Plans, visits, maps and the API the mobile app uses. |
| [`mobile/`](mobile) | Expo (React Native) app for sales reps: today's route on a map, check in with GPS and photo, check out with the outcome. |

## Backend setup

```bash
git clone https://github.com/GopsDev/RouteMitra.git
cp -r RouteMitra/backend $PATH_TO_YOUR_BENCH/apps/routemitra
cd $PATH_TO_YOUR_BENCH
bench pip install -e apps/routemitra
bench --site <your-site> install-app routemitra
```

## Mobile setup

```bash
cd mobile
npm install
npx expo start
```

Open it in Expo Go and log in with your ERPNext site URL and user. See [`mobile/README.md`](mobile/README.md) for the API it calls.

## License

MIT, see [LICENSE](LICENSE).
