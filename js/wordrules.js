// The word rules of the game, written for the two players who judge words by Tahkim (there is no dictionary).
// One source, three places: Settings (reference), the Tahkim dialog (where the decision is made), and the waiting room (so both players agree before starting).
// Arabic is the main text; the Indonesian line under each rule is the same rule in the language of the original rules document.
const L = (ar, id) => `<li><span class="wrAr" lang="ar">${ar}</span><span class="wrId" lang="id" dir="ltr">${id}</span></li>`;
const EX = s => `<bdi class="wrEx" lang="ar">${s}</bdi>`;

const OK = [
  ['الاسم بأنواعه كلها: مفرد، مثنى، جمع، مشتق، مصدر… ' + EX('كتاب · كتابان · كتب · كاتب · كتابة'), 'Semua jenis isim diperbolehkan.'],
  ['الاسم مع «ال» التعريف ' + EX('الكتاب · المدرسة'), 'Isim + alif-lam (الـ) boleh.'],
  ['الاسم المتصل بضمير الملكية ' + EX('كتابي · كتابك · بيتهم'), 'Isim + dhamir muttashil (kepemilikan) boleh.'],
  ['العلم والاسم الأعجمي إذا كان مشهورًا ومستعملًا في العربية ' + EX('محمد · مكة · مصر · شاورما'), "Isim 'alam / ajam hanya jika masyhur dan lazim dalam bahasa Arab."],
  ['الفعل بكل أزمنته وتصريفاته: ماضٍ ومضارع وأمر ' + EX('كتب · يكتبون · اكتبوا'), "Semua fi'il dan tashrif (madhi, mudhari', amr) boleh."],
  ['الفعل المبني للمجهول ' + EX('كُتِبَ · يُكْتَبُ'), "Fi'il pasif (mabni lil-majhul) boleh."],
  ['اللام الملتصقة بالفعل المضارع (استثناء خاص باللعبة) ' + EX('ليقوموا · ليكتبوا'), "Lam yang melekat pada fi'il mudhari' boleh (pengecualian khusus permainan)."],
  ['نون النسوة ونون التوكيد ' + EX('يكتبن · اكتبنَّ'), 'Nun an-niswah dan nun at-tawkid boleh.'],
  ['الحرف المكوّن من حرفين فأكثر ' + EX('من · في · على · هل · لم · قد'), 'Harf dua huruf atau lebih boleh.']
];
const NO = [
  ['الحرف المفرد من حرف واحد ' + EX('و · ف · ب · ك · ل · ت'), 'Harf satu huruf tidak boleh.'],
  ['فعل مجموع مع أداة تُكتب منفصلة، وكأنهما كلمة واحدة ' + EX('لم يكتب · لن يذهب · لا تلعب'), "Gabungan fi'il + partikel/'amil terpisah bukan satu kata (masing-masing boleh dimainkan sendiri)."],
  ['الفعل المتصل بضمير مفعول به ' + EX('ساعدني · ضربه · كتبها · أكرمهم'), "Fi'il + dhamir objek tidak boleh."],
  ['العلم أو الأعجمي غير المشهور وغير المستعمل في العربية', "Isim 'alam / ajam yang tidak masyhur tidak boleh."]
];
const CHECK = [
  ['هل هي كلمة واحدة صحيحة ومعروفة في العربية؟', 'Apakah ini satu kata Arab yang sah dan dikenal?'],
  ['هل الزيادة جزء من صيغة الكلمة ومسموح بها (ال، ضمير الملكية، التصريف، النون، اللام)؟', 'Apakah tambahannya bagian dari bentuk kata dan diizinkan?'],
  ['هل هي تركيب نحوي كان يجب كتابته منفصلًا؟ إن كان كذلك فلا تُحسب كلمة واحدة.', 'Apakah ini gabungan sintaksis yang seharusnya terpisah? Jika ya, tidak dihitung satu kata.']
];
const list = (cls, rows) => `<ul class="wrList ${cls}">${rows.map(([a, i]) => L(a, i)).join('')}</ul>`;

// Full reference (Settings, waiting room).
export const rulesHtml = () => `<div class="wr">
<p class="wrLead"><span lang="ar">كل مفردات العربية تصلح: اسم أو فعل أو حرف، بشرط أن تكون كلمة واحدة صحيحة ومعروفة وفق القواعد الآتية.</span><span class="wrId" lang="id" dir="ltr">Semua kosakata Arab boleh (isim, fi'il, harf) selama satu bentuk kata yang sah dan dikenal, dengan aturan berikut.</span></p>
<h4 class="wrH ok">✔ مسموح · Boleh</h4>${list('ok', OK)}
<h4 class="wrH no">✖ غير مسموح · Tidak boleh</h4>${list('no', NO)}
<h4 class="wrH">أسئلة الحكم الثلاثة · Tiga pertanyaan untuk hakim</h4><ol class="wrList chk">${CHECK.map(([a, i]) => L(a, i)).join('')}</ol>
<p class="wrNote"><span lang="ar">الحركات (التشكيل) للمساعدة في القراءة فقط، ولا تغيّر عدد الحروف.</span><span class="wrId" lang="id" dir="ltr">Harakat hanya bantuan baca, bukan pembeda jumlah huruf.</span></p>
</div>`;

// Compact version for a dialog that must stay small: a one-line summary, the full text one tap away.
export const rulesDetails = () => `<details class="wrBox"><summary>قواعد الكلمات · Aturan kata</summary>${rulesHtml()}</details>`;
