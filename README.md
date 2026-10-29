# LifeFlow

LifeFlow is a simple personal command center for tasks, spending, goals, habits, reminders, and personal insights.

## Live app

- App: https://pharmdaamir2121-ops.github.io/lifeflow/app/
- Privacy policy: https://pharmdaamir2121-ops.github.io/lifeflow/app/privacy.html
- Terms of service: https://pharmdaamir2121-ops.github.io/lifeflow/app/terms.html
- Account deletion: https://pharmdaamir2121-ops.github.io/lifeflow/app/delete-account.html
- Support: pharmdaamir2121@gmail.com

## Current implementation

- Supabase email/password authentication with persistent sessions
- Supabase database storage for tasks, expenses, goals, and habits
- User-scoped data access intended to be protected by Supabase Row Level Security
- Dashboard, reminders, coach responses, analytics, and Pro insights
- Polar checkout for LifeFlow Pro
- Pro checkout is configured to display USD $4.99/month; always verify the actual checkout page before paying
- Privacy, terms, and account-deletion request pages

## Before inviting users

1. Test sign-up using an email account not already registered and verify the confirmation email works.
2. Sign in, add a sample task, expense, goal, and habit, then confirm each is still present after refresh.
3. Confirm the Pro screen shows the intended offer and the Polar checkout displays USD $4.99/month. Do not make a payment just to test the price.
4. Confirm the privacy, terms, and account-deletion links open.
5. Test the app on a phone-sized browser and desktop.
6. Keep at least one backup/export of the current working code before making more changes.

## Notes

- The account-deletion page currently directs users to request deletion by email; deletion is not self-service.
- Billing or cancellation help is currently handled through the listed support email. Verify the cancellation process with Polar before a broad public launch.
- Do not put Supabase service-role keys, Polar access tokens, or webhook secrets in this repository. The frontend may contain only the Supabase publishable/anon key.
