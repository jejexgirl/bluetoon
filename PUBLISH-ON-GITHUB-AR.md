# نشر موقع BlueToon على GitHub Pages (مجاني ودائم)

بعد النشر: الموقع يشتغل بدون أي سيرفر، وتعدّل عليه من الداشبورد، والتعديلات تظهر لكل الناس خلال دقيقة تقريباً.

## 1) أنشئ المستودع
1. سجّل في github.com.
2. اضغط **New repository**.
3. الاسم:
   - `اسمك.github.io` ← رابط الموقع يكون `https://اسمك.github.io` (الأقصر).
   - أو أي اسم، مثل `bluetoon` ← الرابط `https://اسمك.github.io/bluetoon`.
4. اختر **Public** (الخطة المجانية تنشر المستودعات العامة فقط).

## 2) ارفع الملفات
فك ضغط الـ zip، وافتح مجلد المشروع في CMD (يلزمك Git من git-scm.com):
```
git init -b main
git add .
git commit -m "first version"
git remote add origin https://github.com/اسمك/اسم-المستودع.git
git push -u origin main
```
مهم: لازم ينرفع المجلد المخفي `.github` (فيه ملف النشر التلقائي). الأمر فوق يرفعه.

## 3) شغّل النشر
1. في المستودع: **Settings ثم Pages ثم Source**، اختر **GitHub Actions**.
2. روح تبويب **Actions**. إذا ما اشتغل النشر تلقائياً، اضغط **Build and publish the site ثم Run workflow**.
3. بعد دقيقة أو اثنتين يظهر رابط موقعك في Settings ثم Pages.

## 4) مفتاح YouTube للمشاهدات (مهم)
بدونه ممكن العناوين تظهر لكن المشاهدات الحقيقية غالباً ما تنجلب من GitHub.
1. console.cloud.google.com ثم أنشئ مشروع ثم فعّل **YouTube Data API v3** ثم **Credentials ثم Create API key** (مجاني).
2. في المستودع: **Settings ثم Secrets and variables ثم Actions ثم New repository secret**.
3. الاسم `YT_API_KEY` والقيمة هي المفتاح.

المشاهدات تتحدّث تلقائياً كل 6 ساعات.

## 5) مفتاح الداشبورد (GitHub Token)
هذا اللي يعطيك صلاحية التعديل. ما أحد غيرك يقدر يغيّر الموقع بدونه.
1. GitHub ثم صورتك ثم **Settings ثم Developer settings ثم Personal access tokens ثم Fine-grained tokens ثم Generate new token**.
2. **Repository access**: Only select repositories، واختر مستودع الموقع فقط.
3. **Permissions ثم Repository permissions**:
   - **Contents: Read and write** (لازم)
   - **Actions: Read and write** (اختياري، لزر Refresh view counts)
4. اضغط Generate وانسخ المفتاح (يبدأ بـ `github_pat_`). يظهر مرة وحدة فقط.

لا تعطيه لأحد ولا تحطه في أي ملف.

## 6) افتح الداشبورد
1. افتح موقعك واكتب `itsmebluetoon` على الكيبورد.
2. اكتب اسم المستودع (مثل `اسمك/اسم-المستودع`) والمفتاح.
3. أضف فيديوهات وقنوات وغيّر الألوان من تبويب Design، ثم اضغط **Save**.
4. بعد دقيقة تقريباً تظهر التغييرات لكل الزوار، وتنجلب عناوين الفيديوهات والمشاهدات وصور القنوات الجديدة تلقائياً.

## ملاحظات
- في هذا الوضع كلمة سر الداشبورد هي مفتاح GitHub نفسه. ما فيه كلمة سر ثانية، لأن الموقع بدون سيرفر وما يقدر يحميها.
- المستودع عام، فالفيديوهات المخفية تظهر في ملفات المستودع حتى لو ما تظهر في الموقع.
- "Keep me signed in" للجهاز الخاص بك فقط.
- لدومين خاص: Settings ثم Pages ثم Custom domain، وغالباً تحتاج تشتري دومين رخيص مثل `.xyz`.
- لو احتجت نسخة سيرفر Node (فيها كلمة سر وداشبورد خاصة)، راجع `README.md`.
