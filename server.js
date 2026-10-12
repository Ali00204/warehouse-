const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 کلیدهای Supabase از Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if(!SUPABASE_URL || !SUPABASE_KEY){
  console.error('❌ متغیرهای SUPABASE_URL و SUPABASE_KEY تنظیم نشده‌اند');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ====== ارتباط با Supabase ======
async function sb(endpoint, options = {}){
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  const txt = await res.text();
  if(!res.ok){
    throw new Error(`Supabase ${res.status}: ${txt}`);
  }
  return txt ? JSON.parse(txt) : null;
}

// ====== ستون‌های مجاز هر بخش ======
const SECTIONS = {
  incoming:  ['name','code','qty','unit','supplier','date','time','username'],
  cutting:   ['name','code','qty','oper','date','time','status','username'],
  drilling:  ['name','code','type','qty','sender','date','time','status','username'],
  galvanize: ['name','code','qty','receiver','date','time','descr','username'],
  outgoing:  ['name','code','qty','receiver','date','time','username'],
  customer:  ['name','code','qty','customer','driver','plate','waybill','date','time','username']
};

// ====== صفحه اصلی ======
app.get('/', (req,res)=>{
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====== سلامت سرور ======
app.get('/api/health', (req,res)=>{
  res.json({ ok: true, time: new Date().toISOString() });
});

// ====== ورود ======
app.post('/api/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    if(!username || !password)
      return res.status(400).json({ error: 'نام کاربری و رمز الزامی است' });
    const rows = await sb(
      `users?username=eq.${encodeURIComponent(username)}` +
      `&password=eq.${encodeURIComponent(password)}` +
      `&select=id,username,name,role`
    );
    if(!rows || !rows.length)
      return res.status(401).json({ error: 'نام کاربری یا رمز اشتباه' });
    res.json(rows[0]);
  }catch(e){
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ====== گرفتن رکوردهای یک بخش ======
app.get('/api/:section', async (req,res)=>{
  const s = req.params.section;
  if(!SECTIONS[s]) return res.status(404).json({ error: 'بخش نامعتبر' });
  try{
    const rows = await sb(`${s}?select=*&order=id.desc`);
    res.json(rows || []);
  }catch(e){
    console.error(`GET ${s}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ====== افزودن رکورد ======
app.post('/api/:section', async (req,res)=>{
  const s = req.params.section;
  if(!SECTIONS[s]) return res.status(404).json({ error: 'بخش نامعتبر' });
  try{
    const cols = SECTIONS[s];
    const body = {};
    cols.forEach(c => {
      let v = req.body[c];
      if(v === undefined || v === null) v = '';
      body[c] = v;
    });
    body.created_at = new Date().toISOString();
    const rows = await sb(s, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    res.json({ id: rows?.[0]?.id || null, ok: true });
  }catch(e){
    console.error(`POST ${s}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ====== حذف رکورد ======
app.delete('/api/:section/:id', async (req,res)=>{
  const s = req.params.section;
  if(!SECTIONS[s]) return res.status(404).json({ error: 'بخش نامعتبر' });
  try{
    await sb(`${s}?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: 'DELETE'
    });
    res.json({ ok: true });
  }catch(e){
    console.error(`DELETE ${s}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ====== ویرایش رکورد ======
app.patch('/api/:section/:id', async (req,res)=>{
  const s = req.params.section;
  if(!SECTIONS[s]) return res.status(404).json({ error: 'بخش نامعتبر' });
  try{
    const cols = SECTIONS[s];
    const body = {};
    cols.forEach(c => {
      if(req.body[c] !== undefined) body[c] = req.body[c];
    });
    const rows = await sb(`${s}?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
    res.json({ ok: true, data: rows?.[0] || null });
  }catch(e){
    console.error(`PATCH ${s}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ====== آمار کلی ======
app.get('/api/stats/all', async (req,res)=>{
  try{
    const out = {};
    for(const key of Object.keys(SECTIONS)){
      const rows = await sb(`${key}?select=qty`);
      const qty = (rows || []).reduce((a,b)=>a+(+b.qty||0), 0);
      out[key] = { count: (rows || []).length, totalQty: qty };
    }
    res.json(out);
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

// ====== خطاهای پیش‌بینی نشده ======
app.use((err, req, res, next)=>{
  console.error('Server error:', err);
  res.status(500).json({ error: 'خطای داخلی سرور' });
});

app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`✅ سرور روی پورت ${PORT} اجرا شد`);
  console.log(`🌐 آدرس: http://localhost:${PORT}`);
});
