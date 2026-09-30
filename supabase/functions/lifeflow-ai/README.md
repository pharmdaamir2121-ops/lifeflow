# LifeFlow AI Edge Function

This keeps the OpenAI API key server-side. Do not put OPENAI_API_KEY in app/index.html.

## Configure
Set the Supabase Edge Function secret:

OPENAI_API_KEY=your_key

Then deploy this function through the Supabase CLI/dashboard. The current static app can continue using its built-in Coach until this function is deployed.

The function uses the OpenAI Responses API. See the official OpenAI platform documentation for current model/API details.