// دليل المستخدم — يعمل داخل Shadow DOM، و`root_element` يوفّره فرابي.
// لا نستعمل jQuery هنا: البحث داخل shadowRoot أوثق بـ DOM الأصلي.
//
// البنية بوابة لا صفحة واحدة: الصفحة الرئيسية تعرض بطاقات الأقسام، والضغط
// على بطاقة يفتح صفحة القسم (فهرسه وفصوله وحدها) مع زر رجوع. التبديل بحالة
// data-view على الجذر، والفهرس والترقيم يُبنيان لكل قسم على حدة.

(function () {
    const $$ = (sel) => Array.from(root_element.querySelectorAll(sel));
    const $1 = (sel) => root_element.querySelector(sel);

    /* الأقسام الرئيسية: المصدر الوحيد لأسماء البطاقات وأوصافها وترتيبها.
       مفتاح كل قسم يطابق data-cat على الفصول التابعة له في الـ HTML. */
    const CATS = [
        {
            key: "interfaces",
            icon: "🖥️",
            title: "دليل الواجهات",
            desc: "كل واجهات النظام وشاشاتها: واجهة الموظف، الاستحقاقات، الخدمات، الموارد البشرية، والمخزون — كل شاشة ونموذجها مشروحان بالصور خطوة بخطوة."
        },
        {
            key: "cycles",
            icon: "🔄",
            title: "الدورات المستندية",
            // فعّالة لكن بلا فصول بعد: الضغط عليها يفتح صفحة القسم بحالة
            // فارغة (ug-empty) بدل بطاقة «قريباً» المعطَّلة. لملئها لاحقاً:
            // أعِد وسم الفصول بـ data-cat="cycles" فتُحسب وتُعرض تلقائياً.
            desc: "قسم قيد الإعداد: سيجمع لاحقاً الدورات المستندية المترابطة (كدورة المشتريات) في مسار واحد متصل. فصوله الآن ضمن «دليل الواجهات»."
        }
    ];

    const root = $1(".ug-root");
    const sections = $$(".ug-section");
    const tocList = $1("#ug-toc-list");
    const search = $1("#ug-search");
    const status = $1("#ug-search-status");
    const titleEl = $1("#ug-title");
    const subtitleEl = $1("#ug-subtitle");
    const cardsWrap = $1("#ug-cards");
    const backBtn = $1("#ug-back");
    const emptyEl = $1("#ug-empty");

    const HOME_SUBTITLE =
        "اختر القسم الذي تريد تصفّحه. كل قسم يجمع فصوله المصوَّرة خطوة بخطوة.";

    /* أرقام هندية عربية للعدّادات المعروضة داخل نصّ عربي (٨ فصول). */
    const toAr = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

    const secTitle = (sec) =>
        sec.dataset.title || (sec.querySelector("h2") || {}).textContent || sec.id;

    const catSections = (key) => sections.filter((s) => s.dataset.cat === key);

    // العنوان يبدأ برقم داخل <span>، والمطلوب نصّه وحده.
    const stepLabel = (head) =>
        Array.from(head.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join("")
            .trim();

    /* لقطة لم تُرفع بعد تُخفى كاملةً بدل أن تظهر أيقونة صورة مكسورة. */
    $$(".ug-shot img").forEach((img) => {
        img.addEventListener("error", () => {
            const shot = img.closest(".ug-shot");
            if (shot) shot.style.display = "none";
        });
    });

    /* ---------------- بطاقات الصفحة الرئيسية ----------------
       تُبنى من CATS فتُحسب أعداد الفصول من المحتوى لا يدوياً. */
    CATS.forEach((cat) => {
        const count = catSections(cat.key).length;

        const card = document.createElement("button");
        card.type = "button";
        card.className = "ug-card" + (cat.soon ? " is-soon" : "");
        card.dataset.cat = cat.key;
        // البطاقة المؤجَّلة معطَّلة، فلا يفتح الضغط عليها صفحة فارغة.
        card.disabled = !!cat.soon;

        const icon = document.createElement("span");
        icon.className = "ug-card-icon";
        icon.textContent = cat.icon;

        const body = document.createElement("span");
        body.className = "ug-card-body";

        const t = document.createElement("span");
        t.className = "ug-card-title";
        t.textContent = cat.title;

        const d = document.createElement("span");
        d.className = "ug-card-desc";
        d.textContent = cat.desc;

        const foot = document.createElement("span");
        foot.className = "ug-card-foot";

        const meta = document.createElement("span");
        meta.className = "ug-card-meta";
        // قسم فعّال بلا فصول بعد يظلّ قابلاً للضغط ويوضّح حاله بدل عدّ ٠.
        meta.textContent = count ? "📄 " + toAr(count) + " فصول" : "قيد الإعداد";

        const go = document.createElement("span");
        go.className = "ug-card-go";
        go.textContent = "ابدأ ‹";

        foot.appendChild(meta);
        foot.appendChild(go);
        body.appendChild(t);
        body.appendChild(d);
        body.appendChild(foot);
        card.appendChild(icon);
        card.appendChild(body);
        cardsWrap.appendChild(card);
    });

    cardsWrap.addEventListener("click", (e) => {
        const card = e.target.closest(".ug-card");
        if (card && !card.disabled) renderCategory(card.dataset.cat);
    });

    if (backBtn) backBtn.addEventListener("click", renderHome);

    const emptyHome = $1("#ug-empty-home");
    if (emptyHome) emptyHome.addEventListener("click", renderHome);

    /* ---------------- بناء الفهرس لقائمة أقسام ----------------
       يُستدعى لكل قسم على حدة، فالترقيم يبدأ من ١ داخل كل قسم. */
    let tocLinks = [];
    let tocItems = [];
    let tocGroups = [];

    // عناوين الخطوات (المستوى الثالث) لأقسام data-subtoc، تُضاف داخل المجموعة.
    function addSubSteps(sec, ul) {
        sec.querySelectorAll(".ug-step-head").forEach((head, j) => {
            if (!head.id) head.id = sec.id + "-s" + (j + 1);
            const label = stepLabel(head);
            if (!label) return;
            const li = document.createElement("li");
            li.dataset.section = sec.id;
            const a = document.createElement("a");
            a.href = "#" + head.id;
            a.dataset.target = head.id;
            a.className = "is-sub";
            a.textContent = label;
            li.appendChild(a);
            ul.appendChild(li);
        });
    }

    /* الفهرس أكورديون: تظهر العناوين الرئيسية (data-level="main") وحدها،
       وبالضغط على عنوان تنسدل فصوله تحته وتُطوى بقية المجموعات — أرتب
       للتصفّح. كل «main» يبدأ مجموعة، وما يليه من فصول عادية توابع له. */
    function buildToc(list) {
        tocList.innerHTML = "";
        tocGroups = [];
        let group = null;

        // فصول تسبق أول عنوان رئيسي (نادر) توضع في مجموعة بلا رأس تبقى مفتوحة.
        function looseGroup() {
            if (group) return;
            const li = document.createElement("li");
            li.className = "ug-toc-group ug-toc-nohead is-open";
            const ul = document.createElement("ul");
            ul.className = "ug-toc-children";
            li.appendChild(ul);
            tocList.appendChild(li);
            group = { li: li, head: null, headSection: null, ul: ul, sections: [] };
            tocGroups.push(group);
        }

        list.forEach((sec, i) => {
            const title = secTitle(sec);

            if (sec.dataset.level === "main") {
                const li = document.createElement("li");
                li.className = "ug-toc-group";

                const head = document.createElement("button");
                head.type = "button";
                head.className = "ug-toc-head";
                head.dataset.target = sec.id;
                const num = document.createElement("span");
                num.className = "ug-toc-num";
                num.textContent = i + 1;
                head.appendChild(num);
                head.appendChild(document.createTextNode(title));
                const chev = document.createElement("span");
                chev.className = "ug-toc-chev";
                head.appendChild(chev);

                const ul = document.createElement("ul");
                ul.className = "ug-toc-children";

                li.appendChild(head);
                li.appendChild(ul);
                tocList.appendChild(li);

                group = { li: li, head: head, headSection: sec.id, ul: ul, sections: [sec.id] };
                tocGroups.push(group);

                if (sec.dataset.subtoc !== undefined) addSubSteps(sec, ul);
            } else {
                looseGroup();
                const li = document.createElement("li");
                li.dataset.section = sec.id;
                const a = document.createElement("a");
                a.href = "#" + sec.id;
                a.dataset.target = sec.id;
                const num = document.createElement("span");
                num.className = "ug-toc-num";
                num.textContent = i + 1;
                a.appendChild(num);
                a.appendChild(document.createTextNode(title));
                li.appendChild(a);
                group.ul.appendChild(li);
                group.sections.push(sec.id);
                if (sec.dataset.subtoc !== undefined) addSubSteps(sec, group.ul);
            }
        });

        tocLinks = $$("#ug-toc-list [data-target]");
        tocItems = $$("#ug-toc-list li[data-section]");
    }

    /* ---------------- التنقّل بين الصفحات ---------------- */
    let currentSections = [];

    function numberSections(list) {
        list.forEach((sec, i) => {
            const num = sec.querySelector(".ug-sec-num");
            if (num) num.textContent = i + 1;
        });
    }

    function renderHome() {
        root.dataset.view = "home";
        titleEl.textContent = "دليل المستخدم";
        subtitleEl.textContent = HOME_SUBTITLE;
        currentSections = [];
        root.classList.remove("ug-cat-empty");
        if (emptyEl) emptyEl.hidden = true;
        if (search) search.value = "";
        if (status) {
            status.textContent = "";
            status.classList.remove("ug-no-results");
        }
        scrollTop();
    }

    function renderCategory(key) {
        const cat = CATS.find((c) => c.key === key);
        if (!cat) return;

        currentSections = catSections(key);

        // إظهار فصول القسم وإخفاء ما عداها، فالبحث والفهرس لا يمسّان غيرها.
        sections.forEach((s) => {
            s.style.display = s.dataset.cat === key ? "" : "none";
        });

        // قسم فعّال بلا فصول بعد: صفحة بحالة فارغة، بلا فهرس ولا بحث.
        const isEmpty = currentSections.length === 0;
        root.classList.toggle("ug-cat-empty", isEmpty);
        if (emptyEl) emptyEl.hidden = !isEmpty;

        numberSections(currentSections);
        buildToc(currentSections);
        // تبدأ المجموعات مطويّة عدا الأولى، فيرى المستخدم العناوين الرئيسية أولاً.
        if (tocGroups[0]) tocGroups[0].li.classList.add("is-open");

        titleEl.textContent = cat.title;
        subtitleEl.textContent = cat.desc;
        root.dataset.view = key;

        if (search) search.value = "";
        apply_filter("");
        scrollTop();
    }

    /* العنصر الذي يمرّر فعلاً ليس النافذة: فرابي يضبط في مساحات العمل
       (عرض 992px فأكثر) القاعدة
           [data-page-route="Workspaces"] .layout-main-section-wrapper
           { height: 100%; overflow-y: auto }
       فتصير هي الحاوية المتحرّكة والنافذة ثابتة. لذلك window.scrollTo
       و window.pageYOffset لا يفعلان شيئاً هنا. نبحث عن الحاوية بالصعود
       من مضيف الـ Shadow DOM بدل تثبيت اسم صنف قد يتغيّر مع إصدار فرابي. */
    function scroller() {
        let node = root_element.host;
        while (node && node !== document.body && node !== document.documentElement) {
            const style = getComputedStyle(node);
            if (/(auto|scroll|overlay)/.test(style.overflowY) &&
                node.scrollHeight > node.clientHeight + 1) {
                return node;
            }
            node = node.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }

    // بعد تبديل الصفحة نعود إلى أعلى الحاوية المتحرّكة أياً كانت.
    function scrollTop() {
        const sc = scroller();
        if (sc && typeof sc.scrollTo === "function") sc.scrollTo({ top: 0 });
        else if (sc) sc.scrollTop = 0;
    }

    function goTo(id) {
        const target = root_element.getElementById(id);
        if (!target) return;
        // scrollIntoView يحرّك كل حاوية متحرّكة في السلسلة أياً كانت،
        // ويحترم scroll-margin-top المضبوط على القسم فلا يختفي العنوان
        // تحت الشريط الثابت.
        target.scrollIntoView({ behavior: "smooth", block: "start" });

        // إعادة تشغيل الوميض في كل ضغطة: إزالة الصنف وحدها لا تكفي ما لم
        // يُجبَر المتصفّح على إعادة الحساب بين الإزالة والإضافة.
        sections.forEach((s) => s.classList.remove("is-targeted"));
        void target.offsetWidth;
        target.classList.add("is-targeted");
    }

    tocList.addEventListener("click", (e) => {
        // الضغط على عنوان رئيسي يفتح مجموعته (ويطوي البقية) ويقفز إليها،
        // والضغط عليه وهو مفتوح يطويه.
        const head = e.target.closest(".ug-toc-head");
        if (head) {
            e.preventDefault();
            const li = head.parentElement;
            if (li.classList.contains("is-open")) {
                li.classList.remove("is-open");
            } else {
                tocGroups.forEach((g) => {
                    if (!g.li.classList.contains("ug-toc-nohead")) g.li.classList.remove("is-open");
                });
                li.classList.add("is-open");
                goTo(head.dataset.target);
            }
            return;
        }
        const a = e.target.closest("a[data-target]");
        if (a) {
            e.preventDefault();
            goTo(a.dataset.target);
        }
    });

    /* ---------------- البحث ----------------
       المقارنة الحرفية لا تصلح للعربية: نصّ الدليل نفسه يكتب «إذن» تارة
       و«اذن» تارة، فمن يكتب الألف بلا همزة لا يجد نصف الأقسام. لذا
       يُوحَّد الطرفان قبل المقارنة: الهمزات والتاء المربوطة والألف
       المقصورة والتشكيل والتطويل والأرقام العربية. */
    function normalize(s) {
        return (s || "")
            .replace(/[ً-ْٰـ]/g, "")   // تشكيل وتطويل
            .replace(/[أإآٱ]/g, "ا")
            .replace(/ى/g, "ي")
            .replace(/ة/g, "ه")
            .replace(/ؤ/g, "و")
            .replace(/ئ/g, "ي")
            .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
            .toLowerCase();
    }

    // نصّ كل قسم ثابت، فيُهيّأ مرة واحدة لكل الأقسام لا مع كل حرف يُكتب.
    const haystack = new Map(sections.map((sec) => [sec, normalize(sec.textContent)]));

    let timer = null;

    // البحث يعمل داخل القسم المفتوح وحده، فلا يُظهر فصول قسم آخر.
    function apply_filter(term) {
        const q = normalize((term || "").trim());

        if (!q) {
            // خروج من البحث: يعود الفهرس أكورديون ويظهر كل شيء.
            tocList.classList.remove("ug-searching");
            currentSections.forEach((s) => (s.style.display = ""));
            tocItems.forEach((li) => (li.style.display = ""));
            tocGroups.forEach((g) => {
                g.li.style.display = "";
                if (g.head) g.head.style.display = "";
            });
            status.textContent = "";
            status.classList.remove("ug-no-results");
            return;
        }

        // أثناء البحث تُفتح كل المجموعات (عبر ug-searching) وتُصفّى المدخلات.
        tocList.classList.add("ug-searching");
        const hits = new Set();
        let matches = 0;
        currentSections.forEach((sec) => {
            const hit = haystack.get(sec).indexOf(q) !== -1;
            sec.style.display = hit ? "" : "none";
            if (hit) { hits.add(sec.id); matches++; }
        });

        // إخفاء القسم يخفي مدخله في الفهرس وعناوينه الفرعية معه (data-section).
        tocItems.forEach((li) => {
            li.style.display = hits.has(li.dataset.section) ? "" : "none";
        });

        // كل مجموعة: يظهر عنوانها إن طابق قسمها الرئيسي أو أحد فصولها، وتُخفى إن خلت.
        tocGroups.forEach((g) => {
            let any = !!(g.headSection && hits.has(g.headSection));
            g.ul.querySelectorAll("li[data-section]").forEach((li) => {
                if (hits.has(li.dataset.section)) any = true;
            });
            if (g.head) g.head.style.display = any ? "" : "none";
            g.li.style.display = any ? "" : "none";
        });

        status.textContent = matches
            ? matches + (matches === 1 ? " فصل مطابق" : " فصول مطابقة")
            : "لا توجد نتائج";
        status.classList.toggle("ug-no-results", matches === 0);
    }

    if (search) {
        search.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => apply_filter(search.value), 120);
        });

        search.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                search.value = "";
                apply_filter("");
            }
        });

        /* فرابي يعرف «هل المستخدم يكتب في حقل؟» عبر document.activeElement،
           وهذا داخل Shadow DOM يُعيد المضيف لا الحقل، فيظنّ أن لا حقل
           مركَّزاً ويلتقط الحروف كاختصارات عامة ويمنع كتابتها (shift+/ و
           ctrl+s وغيرها). حجب الأحداث عند الحقل يمنعها من الوصول إليه. */
        ["keydown", "keypress", "keyup"].forEach((evt) =>
            search.addEventListener(evt, (e) => e.stopPropagation())
        );
    }

    /* ---------------- تمييز القسم الحالي في الفهرس ---------------- */
    if (window.IntersectionObserver) {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    tocLinks.forEach((a) => a.classList.remove("active"));
                    const link = tocLinks.find((a) => a.dataset.target === entry.target.id);
                    if (link) link.classList.add("active");
                    // تمييز المجموعة الحاوية للقسم الحالي، فتُعرف حتى لو كانت مطويّة.
                    tocGroups.forEach((g) =>
                        g.li.classList.toggle("has-active", g.sections.indexOf(entry.target.id) !== -1)
                    );
                });
            },
            // الشريط العلوي فقط: القسم يُعدّ «الحالي» حين يصل أعلى الشاشة لا حين يملؤها،
            // وإلا بقي القسم الأول محدَّداً طوال التمرير.
            { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
        );
        sections.forEach((sec) => observer.observe(sec));
    }

    /* ---------------- ربط سطر الشرح برقمه على اللقطة ----------------
       تمرير المؤشّر على أي خطوة يُبرز رقمها على الصورة، فلا يضطر القارئ
       للبحث عن الموضع بعينه. الربط داخل القسم الواحد فقط، لأن الأرقام
       تبدأ من 1 في كل قسم. */
    sections.forEach((sec) => {
        const pins = Array.from(sec.querySelectorAll(".ug-pin"));
        if (!pins.length) return;

        sec.querySelectorAll(".ug-steps li[data-pin]").forEach((step) => {
            const pin = pins.find((p) => p.textContent.trim() === step.dataset.pin);
            if (!pin) return;
            step.addEventListener("mouseenter", () => pin.classList.add("is-active"));
            step.addEventListener("mouseleave", () => pin.classList.remove("is-active"));
        });
    });

    /* ---------------- العودة للأعلى ---------------- */
    const topBtn = $1("#ug-top");
    if (topBtn) {
        topBtn.addEventListener("click", () =>
            scroller().scrollTo({ top: 0, behavior: "smooth" })
        );
        const toggle_top = () =>
            topBtn.classList.toggle("is-shown", scroller().scrollTop > 500);
        // حدث scroll لا يصعد في الشجرة، لكنه يُلتقط في مرحلة الالتقاط،
        // فنستمع على المستند ليصلنا تمرير الحاوية أياً كانت.
        document.addEventListener("scroll", toggle_top, { passive: true, capture: true });
        toggle_top();
    }

    /* ---------------- الأسهم على اللقطات ----------------
       الزاوية والطول لا يمكن حسابهما بالنِسَب المئوية وحدها إلا لو كان
       الإطار مربّعاً، فتُحسب هنا بالبكسل وتُعاد عند كل تغيّر في الحجم. */
    function layout_arrows() {
        $$(".ug-shot-frame").forEach((frame) => {
            const w = frame.clientWidth;
            const h = frame.clientHeight;
            if (!w || !h) return;

            frame.querySelectorAll(".ug-arrow").forEach((arrow) => {
                const from = (arrow.dataset.from || "").split(",").map(Number);
                const to = (arrow.dataset.to || "").split(",").map(Number);
                if (from.length !== 2 || to.length !== 2) return;

                const x1 = (from[0] / 100) * w;
                const y1 = (from[1] / 100) * h;
                const dx = (to[0] / 100) * w - x1;
                const dy = (to[1] / 100) * h - y1;

                arrow.style.left = x1 + "px";
                arrow.style.top = y1 + "px";
                arrow.style.width = Math.sqrt(dx * dx + dy * dy) + "px";
                arrow.style.transform = "rotate(" + Math.atan2(dy, dx) + "rad)";
            });
        });
    }

    layout_arrows();
    window.addEventListener("resize", layout_arrows);
    // الصور تُحمَّل بعد تنفيذ السكربت، وقبل تحميلها يكون ارتفاع الإطار صفراً.
    $$(".ug-shot-frame img").forEach((img) => {
        if (!img.complete) img.addEventListener("load", layout_arrows);
    });

    /* ---------------- شبكة المعايرة ----------------
       تظهر فقط عند فتح الصفحة بـ #grid، وتُستعمل لقراءة إحداثيات
       الدوائر والأسهم بدل تخمينها. */
    if (window.location.hash === "#grid") {
        $$(".ug-shot-frame").forEach((frame) => {
            const grid = document.createElement("div");
            grid.className = "ug-grid";
            for (let i = 10; i < 100; i += 10) {
                const col = document.createElement("span");
                col.textContent = i;
                col.style.left = i + "%";
                col.style.top = "0";
                const row = document.createElement("span");
                row.textContent = i;
                row.style.top = i + "%";
                row.style.left = "0";
                grid.appendChild(col);
                grid.appendChild(row);
            }
            frame.appendChild(grid);
        });
    }

    /* ---------------- تكبير اللقطة ---------------- */
    root_element.addEventListener("click", (e) => {
        const img = e.target.closest(".ug-shot-frame img");
        if (!img) return;
        const box = document.createElement("div");
        box.className = "ug-lightbox";
        const big = document.createElement("img");
        big.src = img.src;
        box.appendChild(big);
        box.addEventListener("click", () => box.remove());
        root_element.appendChild(box);
    });

    /* ---------------- الطباعة ----------------
       المحتوى داخل Shadow DOM، وطباعة الصفحة مباشرةً تسحب معها واجهة فرابي
       كاملة. لذا نبني نافذة مستقلة فيها الدليل وتنسيقه فقط.

       زر الطباعة يطبع الدليل «كاملاً» أياً كان القسم المفتوح: نبني فهرساً
       واحداً مقسوماً على الأقسام الرئيسية، ثم كل الفصول مرتّبةً بأقسامها،
       فلا يتأثّر المطبوع بالتصفية أو بالصفحة المعروضة. */
    const esc = (s) =>
        String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    function buildPrintHtml() {
        let toc = "";
        let content = "";

        CATS.forEach((cat) => {
            const list = catSections(cat.key);
            // قسم بلا فصول (كالدورات المستندية الآن) لا يُطبع له عنوان فارغ.
            if (!list.length) return;

            toc += '<li class="ug-print-cat"><span>' + esc(cat.title) + "</span></li>";

            list.forEach((sec, i) => {
                const isMain = sec.dataset.level === "main";
                toc +=
                    '<li class="' + (isMain ? "is-main-item" : "") + '">' +
                    '<a class="' + (isMain ? "is-main" : "") + '">' +
                    '<span class="ug-toc-num">' + (i + 1) + "</span>" +
                    esc(secTitle(sec)) + "</a></li>";

                if (sec.dataset.subtoc !== undefined) {
                    sec.querySelectorAll(".ug-step-head").forEach((head) => {
                        const label = stepLabel(head);
                        if (label) {
                            toc += '<li><a class="is-sub">' + esc(label) + "</a></li>";
                        }
                    });
                }

                // نسخة من الفصل مع تصفير أي إخفاء وضبط رقمه داخل قسمه.
                const clone = sec.cloneNode(true);
                clone.style.display = "";
                const num = clone.querySelector(".ug-sec-num");
                if (num) num.textContent = i + 1;
                content += clone.outerHTML;
            });
        });

        return (
            '<div class="ug-root" dir="rtl">' +
            '<header class="ug-hero"><div class="ug-hero-text">' +
            '<span class="ug-hero-kicker">نظام AFPPF · دليل المستخدم</span>' +
            "<h1>دليل المستخدم</h1>" +
            "<p>الدليل الكامل — كل الأقسام والفصول.</p>" +
            "</div></header>" +
            '<div class="ug-layout">' +
            '<nav class="ug-toc"><h2>المحتويات</h2><ul>' + toc + "</ul></nav>" +
            '<main class="ug-content">' + content +
            '<p class="ug-footer">آخر تحديث: يوليو 2026 — نظام AFPPF</p>' +
            "</main></div></div>"
        );
    }

    $1("#ug-print").addEventListener("click", () => {
        const css = Array.from(root_element.querySelectorAll("style"))
            .map((s) => s.textContent)
            .join("\n");

        const html = buildPrintHtml();

        const win = window.open("", "_blank");
        if (!win) {
            frappe.msgprint(__("المتصفح منع فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة."));
            return;
        }

        win.document.open();
        win.document.write(
            '<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">' +
                "<title>دليل المستخدم — AFPPF</title>" +
                "<style>@page { size: A4 portrait; margin: 12mm; } " +
                // بدون هذين السطرين تطبع المتصفّحات الترويسة والصناديق
                // بيضاء بلا ألوان مهما فعل التنسيق.
                "html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } " +
                "body { margin: 0; background: #fff; }" +
                "</style>" +
                "<style>" + css + "</style>" +
                "</head><body>" + html + "</body></html>"
        );
        win.document.close();

        // الطباعة قبل تهيئة التخطيط تخرج بصفحة فارغة أحياناً.
        win.onload = () => {
            // كل التفاصيل تُفتح ليُطبع محتواها؛ المطوي لا يُطبع مهما فعل الـ CSS.
            Array.from(win.document.querySelectorAll("details")).forEach((d) =>
                d.setAttribute("open", "open")
            );
            win.focus();
            win.print();
        };
    });

    /* ---------------- الإقلاع على الصفحة الرئيسية ---------------- */
    renderHome();
})();
