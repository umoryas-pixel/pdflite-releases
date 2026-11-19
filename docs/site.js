(function(){
const P=window.PL||{},$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const T={en:{
 nav_features:'Features',nav_pricing:'Pricing',nav_faq:'FAQ',nav_dl:'Download',
 h1:'The PDF viewer that opens instantly.',lead:'A fast, minimal PDF app for Windows with everything site teams need: markup, measuring, stamps, signatures, merge, split, compress and OCR. Your files never leave your computer.',
 cta_dl:'Download for Windows',cta_buy:'Buy a license',hero_note:'30-day free trial · no account · no card needed',
 f_h:'Everything you need, nothing you don\'t',f_s:'Built for people who review drawings and documents all day.',
 f1t:'Instant and light',f1p:'Opens big drawings in a blink and stays smooth while zooming, even on older PCs.',
 f2t:'Markup that sticks',f2p:'Highlight, pen, text, callouts with arrows, shapes. Save a new PDF with your markup included.',
 f3t:'Measure and count',f3p:'Set the scale once, then measure lengths and areas, or count items directly on the drawing.',
 f4t:'Stamps and signatures',f4p:'Approved, Rejected, For Construction and your own stamps. Draw, type or upload your signature.',
 f5t:'PDF tools',f5p:'Merge, split, extract, rotate, compress, turn images into PDF, PDF into pictures, page numbers and watermarks.',
 f6t:'OCR in English and Arabic',f6p:'Read scanned pages so you can search and copy their text. It runs on your PC.',
 f7t:'Tabs',f7p:'Keep several PDFs open in one window and switch between them with Ctrl+Tab.',
 f8t:'Arabic and English',f8p:'A full Arabic interface with right-to-left layout. Switch any time.',
 f9t:'Private by design',f9p:'Everything is processed on your computer. Nothing is uploaded.',
 h_s:'Get started in a minute',h1t:'Download and install',h1p:'Run the installer. Windows 10 and 11.',h2t:'Try it free for 30 days',h2p:'Every feature is unlocked during the trial.',h3t:'Buy a license when ready',h3p:'Pay online and your key appears instantly. Paste it in the app.',
 p_h:'Simple pricing',p_s:'One payment. No subscription.',p_name:'PDF Lite license',p_per:'one-time',
 p1:'Every feature, no limits',p2:'Free updates',p3:'Use on your own computers',p4:'Instant key after payment',p_btn:'Buy now',p_note:'Pay securely with mada, Apple Pay or card.',
 q_h:'Questions',
 q1:'What happens after the 30-day trial?',a1:'You can keep opening your files, but markup and tools lock until you add a license key.',
 q2:'How do I get my key?',a2:'Right after payment you are taken to a page that shows your key, and it is also sent to your email. Open PDF Lite, click the Trial label, and paste it.',
 q3:'Is my data safe?',a3:'Your PDFs stay on your computer. We only keep the email you give us to deliver the license.',
 q4:'Does it work on phones and tablets?',a4:'Yes, there is a browser version you can add to your home screen.',
 q5:'Can I get a refund?',a5:'Yes, within 7 days if it does not work for you. See the refund policy.',
 m_h:'Buy PDF Lite',m_p:'Enter the email where your license key should be sent.',m_email:'Your email',m_go:'Continue to payment',m_cancel:'Cancel',
 e_mail:'Please enter a valid email address.',e_srv:'The payment service is not available right now. Please try again or contact us on WhatsApp.',e_wait:'Please wait…',
 f_terms:'Terms',f_priv:'Privacy',f_ref:'Refunds',f_help:'Support on WhatsApp',f_app:'Use in browser',
 th_h:'Thank you!',th_wait:'Confirming your payment…',th_ok:'Payment received. Here is your license key:',th_copy:'Copy key',th_copied:'Copied',
 th_how:'How to activate',th_1:'Open PDF Lite.',th_2:'Click the "Trial" label at the top (or Tools → License).',th_3:'Paste the key and press Activate.',
 th_mail:'We also sent the key to your email. Keep it somewhere safe.',th_bad:'We could not confirm this payment yet. If you paid, wait a minute and refresh, or message us on WhatsApp with your email.',th_none:'No payment found. Go back to the website to buy a license.',th_home:'Back to the website'
},ar:{
 nav_features:'المميزات',nav_pricing:'السعر',nav_faq:'الأسئلة',nav_dl:'تنزيل',
 h1:'قارئ PDF يفتح فوراً.',lead:'برنامج PDF سريع وبسيط لنظام ويندوز، فيه كل ما يحتاجه فريق الموقع: تعليقات وقياس وأختام وتواقيع ودمج وتقسيم وضغط وتعرّف على النصوص. ملفاتك لا تغادر جهازك.',
 cta_dl:'تنزيل لويندوز',cta_buy:'شراء ترخيص',hero_note:'تجربة مجانية 30 يوماً · بدون حساب · بدون بطاقة',
 f_h:'كل ما تحتاجه دون زيادة',f_s:'مصمم لمن يراجع المخططات والمستندات طوال اليوم.',
 f1t:'سريع وخفيف',f1p:'يفتح المخططات الكبيرة في لحظة ويبقى سلساً عند التكبير حتى على الأجهزة القديمة.',
 f2t:'تعليقات تبقى',f2p:'تظليل وقلم ونص وتعليقات بأسهم وأشكال. احفظ ملف PDF جديداً يتضمن تعليقاتك.',
 f3t:'قياس وعدّ',f3p:'اضبط المقياس مرة واحدة ثم قِس الأطوال والمساحات أو عدّ العناصر على المخطط مباشرة.',
 f4t:'أختام وتواقيع',f4p:'معتمد، مرفوض، للتنفيذ وأختامك الخاصة. ارسم توقيعك أو اكتبه أو ارفعه كصورة.',
 f5t:'أدوات PDF',f5p:'دمج وتقسيم واستخراج وتدوير وضغط، وتحويل الصور إلى PDF والعكس، وأرقام الصفحات والعلامات المائية.',
 f6t:'التعرف على النص عربي وإنجليزي',f6p:'اقرأ الصفحات الممسوحة ضوئياً لتبحث فيها وتنسخ نصها. يعمل على جهازك.',
 f7t:'تبويبات',f7p:'افتح عدة ملفات PDF في نافذة واحدة وتنقّل بينها بـ Ctrl+Tab.',
 f8t:'عربي وإنجليزي',f8p:'واجهة عربية كاملة بتخطيط من اليمين لليسار. بدّل متى شئت.',
 f9t:'خصوصية كاملة',f9p:'كل المعالجة على جهازك ولا يُرفع أي شيء.',
 h_s:'ابدأ خلال دقيقة',h1t:'نزّل وثبّت',h1p:'شغّل المثبّت. يعمل على ويندوز 10 و11.',h2t:'جرّبه مجاناً 30 يوماً',h2p:'كل المميزات مفتوحة خلال التجربة.',h3t:'اشترِ الترخيص عندما تكون جاهزاً',h3p:'ادفع أونلاين فيظهر المفتاح فوراً. الصقه في البرنامج.',
 p_h:'سعر بسيط',p_s:'دفعة واحدة. بدون اشتراك.',p_name:'ترخيص PDF Lite',p_per:'دفعة واحدة',
 p1:'كل المميزات بلا حدود',p2:'تحديثات مجانية',p3:'استخدمه على أجهزتك الخاصة',p4:'مفتاح فوري بعد الدفع',p_btn:'اشترِ الآن',p_note:'ادفع بأمان عبر مدى أو Apple Pay أو البطاقة.',
 q_h:'الأسئلة الشائعة',
 q1:'ماذا يحدث بعد انتهاء التجربة؟',a1:'تستطيع فتح ملفاتك، لكن التعليقات والأدوات تُقفل حتى تضيف مفتاح الترخيص.',
 q2:'كيف أحصل على المفتاح؟',a2:'بعد الدفع مباشرة تنتقل إلى صفحة تعرض مفتاحك، ويُرسل أيضاً إلى بريدك. افتح PDF Lite وانقر على كلمة «تجربة» والصق المفتاح.',
 q3:'هل بياناتي آمنة؟',a3:'ملفات PDF تبقى على جهازك. نحتفظ فقط بالبريد الذي تعطينا إياه لإرسال الترخيص.',
 q4:'هل يعمل على الجوال والتابلت؟',a4:'نعم، توجد نسخة للمتصفح يمكن إضافتها إلى الشاشة الرئيسية.',
 q5:'هل يمكنني استرجاع المبلغ؟',a5:'نعم خلال 7 أيام إذا لم يناسبك. راجع سياسة الاسترجاع.',
 m_h:'شراء PDF Lite',m_p:'أدخل البريد الذي سيُرسل إليه مفتاح الترخيص.',m_email:'بريدك الإلكتروني',m_go:'المتابعة إلى الدفع',m_cancel:'إلغاء',
 e_mail:'يرجى إدخال بريد إلكتروني صحيح.',e_srv:'خدمة الدفع غير متاحة الآن. حاول مرة أخرى أو راسلنا على واتساب.',e_wait:'يرجى الانتظار…',
 f_terms:'الشروط',f_priv:'الخصوصية',f_ref:'الاسترجاع',f_help:'الدعم عبر واتساب',f_app:'استخدمه من المتصفح',
 th_h:'شكراً لك!',th_wait:'جارٍ تأكيد الدفع…',th_ok:'تم استلام الدفع. هذا هو مفتاح الترخيص:',th_copy:'نسخ المفتاح',th_copied:'تم النسخ',
 th_how:'طريقة التفعيل',th_1:'افتح PDF Lite.',th_2:'انقر على كلمة «تجربة» في الأعلى (أو الأدوات ← الترخيص).',th_3:'الصق المفتاح واضغط «تفعيل».',
 th_mail:'أرسلنا المفتاح أيضاً إلى بريدك. احتفظ به في مكان آمن.',th_bad:'لم نتمكن من تأكيد الدفع بعد. إذا دفعت فانتظر دقيقة وحدّث الصفحة، أو راسلنا على واتساب مع بريدك.',th_none:'لا توجد عملية دفع. ارجع إلى الموقع لشراء ترخيص.',th_home:'العودة إلى الموقع'
}};
let L='en';try{L=localStorage.plsite||((navigator.language||'').toLowerCase().startsWith('ar')?'ar':'en')}catch(e){}
function setLang(l){L=l;try{localStorage.plsite=l}catch(e){}
 document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr';
 $$('[data-t]').forEach(e=>{const v=T[l][e.dataset.t];if(v!=null)e.textContent=v});
 $$('[data-p]').forEach(e=>{const v=T[l][e.dataset.p];if(v!=null)e.placeholder=v});
 $$('.lang').forEach(b=>b.textContent=l==='ar'?'English':'العربية');
 $$('img[data-shot]').forEach(i=>i.src='img/app-'+l+'.png');
 const pe=$('#amt');if(pe&&pe.dataset.v)pe.innerHTML=fmtPrice(pe.dataset.v)}
window.plT=k=>T[L][k];window.plLang=()=>L;window.plSetLang=setLang;
const fmtPrice=v=>L==='ar'?v+' <small>ر.س</small>':v+' <small>SAR</small>';
$$('.lang').forEach(b=>b.onclick=()=>setLang(L==='ar'?'en':'ar'));
$$('[data-dl]').forEach(a=>a.href=P.DOWNLOAD);$$('[data-app]').forEach(a=>a.href=P.APP);
$$('[data-wa]').forEach(a=>a.href='https://wa.me/'+P.WHATSAPP);
/* price: the server is the source of truth */
const pe=$('#amt');
if(pe){pe.dataset.v=P.PRICE;fetch(P.API+'/api/price').then(r=>r.json()).then(j=>{if(j&&j.price){pe.dataset.v=j.price;pe.innerHTML=fmtPrice(j.price)}}).catch(()=>{})}
/* checkout */
const dlg=$('#buyDlg');
$$('[data-buy]').forEach(b=>b.onclick=e=>{e.preventDefault();if(dlg){$('#bErr').textContent='';dlg.showModal();$('#bEmail').focus()}});
if(location.hash==='#buy'&&dlg)setTimeout(()=>dlg.showModal(),300);
const go=$('#bGo');
if(go)go.onclick=async()=>{
 const em=$('#bEmail').value.trim().toLowerCase(),err=$('#bErr');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)||em.length>120){err.textContent=T[L].e_mail;return}
 err.textContent=T[L].e_wait;go.disabled=true;
 try{
  const r=await fetch(P.API+'/api/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:em,lang:L})});
  const j=await r.json();if(!r.ok||!j.url||!j.id)throw 0;
  try{localStorage.setItem('pl_order',JSON.stringify({id:j.id,t:Date.now()}))}catch(e){}
  location.href=j.url;
 }catch(e){err.textContent=T[L].e_srv;go.disabled=false}};
$$('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
setLang(L);
})();
