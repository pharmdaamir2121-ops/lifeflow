import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type" };
serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const {message,context}=await req.json();
    if(!message) return new Response(JSON.stringify({error:"Message required"}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
    const key=Deno.env.get("OPENAI_API_KEY");
    if(!key) return new Response(JSON.stringify({error:"AI service is not configured yet."}),{status:503,headers:{...cors,"Content-Type":"application/json"}});
    const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},body:JSON.stringify({model:"gpt-5.6-luna",input:[{role:"system",content:"You are LifeFlow Coach. Give concise, practical personal productivity guidance. Use the user's supplied LifeFlow context. Do not provide medical, legal, or financial advice as professional advice."},{role:"user",content:"LifeFlow context:\n"+JSON.stringify(context||{})+"\n\nUser: "+message}],max_output_tokens:500})});
    const j=await r.json();
    if(!r.ok) return new Response(JSON.stringify({error:j.error?.message||"AI request failed"}),{status:502,headers:{...cors,"Content-Type":"application/json"}});
    const text=j.output_text||j.output?.flatMap(x=>x.content||[]).map(x=>x.text||"").join("")||"";
    return new Response(JSON.stringify({answer:text}),{headers:{...cors,"Content-Type":"application/json"}});
  }catch(e){return new Response(JSON.stringify({error:e.message||"Server error"}),{status:500,headers:{...cors,"Content-Type":"application/json"}});}
});