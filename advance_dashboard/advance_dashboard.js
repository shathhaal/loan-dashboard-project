frappe.pages['advance_dashboard'].on_page_load = function(wrapper) {
    let page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Advance Dashboard',
        single_column: true
    });
    
    page.add_inner_button(__('تصدير PDF'), () => {
        if (!window.loan_dashboard) {
            window.print();
            return;
        }

        const d = new frappe.ui.Dialog({
            title: __('اتجاه الطباعة'),
            fields: [
                {
                    fieldname: "orientation",
                    fieldtype: "Select",
                    label: __('اتجاه الصفحة'),
                    options: [
                        { value: "landscape", label: __('أفقي (Landscape) — مناسب للجداول العريضة') },
                        { value: "portrait",  label: __('عمودي (Portrait)') }
                    ],
                    default: "landscape",
                    reqd: 1
                }
            ],
            primary_action_label: __('طباعة'),
            primary_action(values) {
                d.hide();
                window.loan_dashboard.print_dashboard(values.orientation || "landscape");
            }
        });
        d.show();
    });

    $(wrapper).find(".layout-main-section").html(
        frappe.render_template("advance_dashboard", {})
    );

    // Chart.js is vendored into the app -- the server has no internet access,
    // so the old jsdelivr <script> tag in the template never loaded.
    frappe.require("/assets/afppf_project_management/js/chart.umd.min.js", () => {
        setTimeout(() => {
            window.loan_dashboard = new LoanAnalyticsDashboard();
        }, 150);
    });
};

class LoanAnalyticsDashboard {
    constructor() {
        this.charts = {};
        this.prevent_trigger = false; 

        this.filters = {
            period: "year",
            from_date: "",
            to_date: "",
            employee: "",
            loan_product: ""
        };

        this.init();
    }

    init() {
        this.init_erpnext_filters();
        this.bind_events();
        this.set_period(true); 
        this.load_data();
    }

    init_erpnext_filters() {
        let me = this;

        this.from_date_control = frappe.ui.form.make_control({
            parent: $("#from-date-filter"),
            df: {
                fieldtype: "Date",
                fieldname: "from_date",
                placeholder: "من تاريخ",
                onchange: function() {
                    if (me.prevent_trigger) return;
                    let val = this.get_value() || "";
                    if (me.filters.from_date !== val) {
                        me.filters.from_date = val;
                        me.load_data();
                    }
                }
            },
            render_input: true
        });

        this.to_date_control = frappe.ui.form.make_control({
            parent: $("#to-date-filter"),
            df: {
                fieldtype: "Date",
                fieldname: "to_date",
                placeholder: "إلى تاريخ",
                onchange: function() {
                    if (me.prevent_trigger) return;
                    let val = this.get_value() || "";
                    if (me.filters.to_date !== val) {
                        me.filters.to_date = val;
                        me.load_data();
                    }
                }
            },
            render_input: true
        });

        this.employee_control = frappe.ui.form.make_control({
            parent: $("#employee-filter"),
            df: {
                fieldtype: "Link",
                options: "Employee",
                fieldname: "employee",
                placeholder: "ابحث عن موظف...",
                onchange: function() {
                    if (me.prevent_trigger) return;
                    let val = this.get_value() || "";
                    if (me.filters.employee !== val) {
                        me.filters.employee = val;
                        me.load_data();
                    }
                }
            },
            render_input: true
        });

        this.loan_product_control = frappe.ui.form.make_control({
            parent: $("#loan-product-filter"),
            df: {
                fieldtype: "Link",
                options: "Loan Product",
                fieldname: "loan_product",
                placeholder: "نوع السلفة...",
                onchange: function() {
                    if (me.prevent_trigger) return;
                    let val = this.get_value() || "";
                    if (me.filters.loan_product !== val) {
                        me.filters.loan_product = val;
                        me.load_data();
                    }
                }
            },
            render_input: true
        });
    }

    set_period(prevent_reload = false) {
        let today = new Date();
        let year = today.getFullYear();
        let from, to;

        switch (this.filters.period) {
            case "month":
                from = new Date(year, today.getMonth(), 1);
                to = new Date(year, today.getMonth() + 1, 0);
                break;
            case "quarter":
                // الربع الأول (يناير - مارس) من السنة العاملة، وليس الربع الحالي.
                // السنة تُؤخذ من "من تاريخ" إن كان محدداً حتى يمكن اختيار سنة أخرى.
                let qYear = year;
                if (this.filters.from_date) {
                    let parsed = new Date(this.filters.from_date).getFullYear();
                    if (!isNaN(parsed)) qYear = parsed;
                }
                from = new Date(qYear, 0, 1);
                to = new Date(qYear, 2, 31);
                break;
            case "half":
                if (today.getMonth() < 6) {
                    from = new Date(year, 0, 1);
                    to = new Date(year, 5, 30);
                } else {
                    from = new Date(year, 6, 1);
                    to = new Date(year, 11, 31);
                }
                break;
            case "year":
                from = new Date(year, 0, 1);
                to = new Date(year, 11, 31);
                break;
            default:
                from = null;
                to = null;
        }

        this.prevent_trigger = true;

        if (from && to) {
            this.filters.from_date = frappe.datetime.obj_to_str(from);
            this.filters.to_date = frappe.datetime.obj_to_str(to);
            if (this.from_date_control) this.from_date_control.set_value(this.filters.from_date);
            if (this.to_date_control) this.to_date_control.set_value(this.filters.to_date);
        }

        this.prevent_trigger = false;

        if (!prevent_reload) {
            this.load_data();
        }
    }

    bind_events() {
        let me = this;
        $("#period-filter").on("change", function() {
            me.filters.period = $(this).val();
            me.set_period();
        });

        // مفتاح "متأخرة": يفتح/يغلق قسم المتأخرات بالكامل.
        $("#overdue-toggle-card").on("click", function() {
            me.toggle_overdue_section();
        }).on("keydown", function(e) {
            if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                me.toggle_overdue_section();
            }
        });

        $("#overdue-details-btn").on("click", function() {
            let section = $("#overdue-details-section");
            if (section.is(":visible")) {
                section.slideUp(200);
                $(".overdue-section").removeClass("details-open");
                $(this).text("📋 عرض تفاصيل السلف المتأخرة");
                return;
            }
            $(this).text("إخفاء التفاصيل");
            $(".overdue-section").addClass("details-open");
            section.slideDown(200);
            me.load_overdue_details();
            // التمرير إلى قسم البطاقات نفسه حتى يظهر الجدول ملاصقاً لها
            $("html, body").animate({
                scrollTop: $(".overdue-section").offset().top - 70
            }, 300);
        });
    }

    // يفتح/يغلق قسم المتأخرات كله: البطاقتان، رسم الأعمار، الزر، والجدول.
    // الإغلاق يُعيد الجزء التفصيلي إلى حالته الأولى حتى لا يظهر مفتوحاً
    // فجأة عند إعادة الفتح.
    toggle_overdue_section() {
        const section = $("#overdue-section");
        const card = $("#overdue-toggle-card");
        const open = !section.is(":visible");

        card.toggleClass("is-open", open).attr("aria-expanded", open ? "true" : "false");
        card.find(".overdue-toggle-hint").text(open ? "اضغط للإخفاء" : "اضغط للعرض");

        if (!open) {
            section.hide().removeClass("details-open");
            $("#overdue-details-section").hide();
            $("#overdue-details-btn").text("📋 عرض تفاصيل السلف المتأخرة");
            return;
        }

        section.show();
        // Chart.js يقيس الحاوية لحظة الإنشاء؛ ما دام القسم مخفياً يخرج
        // الرسم بارتفاع صفر، لذا يُرسم أول مرة هنا بعد أن صار مرئياً.
        this.render_overdue_aging_chart();
        $("html, body").animate({ scrollTop: section.offset().top - 70 }, 300);
    }

    load_overdue_details() {
        let me = this;
        let container = $("#overdue-details-container");
        container.html('<div class="no-data-alert">جاري التحميل...</div>');

        frappe.call({
            method: "afppf_project_management.afppf_project_management.page.advance_dashboard.advance_dashboard.get_overdue_loan_details",
            args: {
                filters: JSON.stringify(me.filters)
            },
            callback(r) {
                me.render_overdue_details(r.message || []);
            }
        });
    }

    render_overdue_details(rows) {
        let container = $("#overdue-details-container");
        container.empty();

        if (!rows.length) {
            container.html(`
                <div class="no-data-alert">
                    لا توجد سلف متأخرة للفترة المحددة
                </div>
            `);
            return;
        }

        let totalOverdue = rows.reduce((sum, r) => sum + parseFloat(r.overdue_amount || 0), 0);

        let bodyHtml = rows.map(row => {
            return `
                <tr>
                    <td class="wrap-col">${row.employee_name || "-"}</td>
                    <td class="wrap-col">${row.department || "-"}</td>
                    <td class="wrap-col">${this.product_cell(row.loan_product)}</td>
                    <td class="date-col">${this.format_date(row.posting_date)}</td>
                    <td class="num-col">${this.currency(row.loan_amount)}</td>
                    <td class="num-col amount-paid">${this.currency(row.paid_amount)}</td>
                    <td class="num-col">${this.currency(row.monthly_repayment_amount)}</td>
                    <td class="num-col">${row.installments_due || 0}</td>
                    <td class="date-col">${this.format_date(row.first_due_date)}</td>
                    <td class="num-col amount-remaining">${this.currency(row.overdue_amount)}</td>
                </tr>
            `;
        }).join("");

        container.append(`
            <div class="employee-dashboard-container overdue-table-block" style="direction:rtl; text-align:right;">
                <div class="info-badge-container">
                    <div class="info-card-badge"><strong>عدد السلف المتأخرة:</strong> ${rows.length}</div>
                    <div class="info-card-badge"><strong>إجمالي المبالغ المتأخرة:</strong> ${this.currency(totalOverdue)}</div>
                </div>
                <div class="table-responsive loan-table-scroll">
                    <table class="table custom-hover-table loan-detail-table">
                        <colgroup>
                            <col style="width:15%;">
                            <col style="width:14%;">
                            <col style="width:11%;">
                            <col style="width:10%;">
                            <col style="width:10%;">
                            <col style="width:10%;">
                            <col style="width:8%;">
                            <col style="width:7%;">
                            <col style="width:8%;">
                            <col style="width:7%;">
                        </colgroup>
                        <thead>
                            <tr>
                                <th>الموظف</th>
                                <th>الإدارة / القسم</th>
                                <th>نوع السلفة</th>
                                <th>تاريخ السلفة</th>
                                <th class="num-col">مبلغ السلفة</th>
                                <th class="num-col">المدفوع</th>
                                <th class="num-col">قيمة القسط</th>
                                <th class="num-col">أقساط مستحقة</th>
                                <th>أقدم استحقاق</th>
                                <th class="num-col">المبلغ المتأخر</th>
                            </tr>
                        </thead>
                        <tbody>${bodyHtml}</tbody>
                    </table>
                </div>
            </div>
        `);
    }

    load_data() {
        let me = this;
        frappe.call({
            method: "afppf_project_management.afppf_project_management.page.advance_dashboard.advance_dashboard.get_dashboard_data",
            args: {
                filters: JSON.stringify(me.filters)
            },
            callback(r) {
                if (!r.message) return;
                me.data = r.message;
                
                me.update_cards();
                me.render_charts();
                me.render_employees();
            }
        });
    }

    update_cards() {
        let d = this.data;
        $("#total-loan-amount").text(this.currency(d.total_loan));
        $("#total-paid-amount").text(this.currency(d.total_paid));
        $("#average-loan-amount").text(this.currency(d.average_loan));
        $("#remaining-loan-amount").text(this.currency(d.remaining));

        $("#total-requests").text(d.loan_count || 0);
        $("#approved-requests").text(d.approved || 0);
        $("#pending-requests").text(d.pending || 0);
        $("#rejected-requests").text(d.rejected || 0);
        $("#repayment-rate").text((d.repayment_rate || 0) + "%");

        $("#overdue-count").text(d.overdue_count || 0);
        $("#overdue-badge-count").text(d.overdue_count || 0);
        $("#overdue-amount").text(this.currency(d.overdue_amount || 0));
        if (d.overdue_cutoff) {
            $("#overdue-cutoff-label").text(this.format_date(d.overdue_cutoff));
        }

        // Keep an open drill-down in sync when filters change.
        if ($("#overdue-details-section").is(":visible")) {
            this.load_overdue_details();
        }
    }

    currency(value) {
        return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    // التواريخ تصل من Frappe بصيغة ISO (وأحياناً معها وقت) — تُعرض كاملة: يوم/شهر/سنة.
    // بدون هذا كان الجزء بعد المسافة يلتف لسطر ثانٍ أو يُقصّ داخل خلية الجدول.
    format_date(value) {
        if (!value) return "-";
        const [y, m, d] = String(value).trim().split(" ")[0].split("-");
        if (!y || !m || !d) return String(value);
        return `${d}/${m}/${y}`;
    }

    render_charts() {
        this.render_month_chart();
        this.render_overdue_aging_chart();
        this.render_status_chart();
        this.render_product_chart();
    }

    print_dashboard(orientation = "landscape") {
        const isPortrait = orientation === "portrait";
        const source = document.querySelector(".loan-dashboard");
        if (!source) {
            window.print();
            return;
        }

        // A cloned <canvas> is always blank -- the bitmap does not travel with
        // the node. Snapshot each chart to a PNG first, in document order, then
        // swap the clones for <img> elements.
        const snapshots = [];
        source.querySelectorAll("canvas").forEach(c => {
            try {
                snapshots.push(c.toDataURL("image/png", 1.0));
            } catch (e) {
                snapshots.push(null);
            }
        });

        const clone = source.cloneNode(true);
        clone.querySelectorAll("canvas").forEach((c, i) => {
            if (!snapshots[i]) return;
            const img = document.createElement("img");
            img.src = snapshots[i];
            img.className = "print-chart-img";
            c.parentNode.replaceChild(img, c);
        });

        // frappe-charts يولّد الـ SVG بعرض وارتفاع ثابتين وبلا viewBox، فأي
        // max-height في الـ CSS يقصّ الرسم بدل أن يصغّره. إضافة viewBox
        // تجعله قابلاً للتحجيم فعلاً. مقصورة على رسوم تقدّم السداد داخل
        // بطاقات الموظفين — دائرتا صفحة الرسوم مضبوطتان بمقاسهما الأصلي.
        clone.querySelectorAll(".employee-annual-row .chart-wrapper svg").forEach(svg => {
            if (svg.getAttribute("viewBox")) return;
            const w = parseFloat(svg.getAttribute("width"));
            const h = parseFloat(svg.getAttribute("height"));
            if (!w || !h) return;
            svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
            svg.removeAttribute("width");
            svg.removeAttribute("height");
        });

        // Interactive-only elements have no meaning on paper.
        clone.querySelectorAll(".overdue-details-btn, .filters-panel, .overdue-toggle-hint").forEach(el => el.remove());

        // ترتيب الصفحات: (1) العنوان والبطاقات (2) الرسوم (3) المتأخرات
        // (4) صفحة لكل موظف. قسم المتأخرات يقع في الـ DOM بين البطاقات
        // والرسوم، فيُنقل هنا خلف الدوائر ليأخذ صفحته الخاصة في مكانها من
        // هذا الترتيب. الغلاف يُبنى فقط عند فتح القسم — غلاف فارغ حول
        // عنصرين مخفيين كان يطبع صفحتين بيضاوين.
        const overdueBlocks = [
            clone.querySelector("#overdue-section"),
            clone.querySelector("#overdue-details-section")
        ].filter(Boolean);
        const visibleOverdue = overdueBlocks.filter(el => el.style.display !== "none");

        overdueBlocks.filter(el => el.style.display === "none").forEach(el => el.remove());

        if (visibleOverdue.length) {
            const page = document.createElement("div");
            page.className = "print-overdue-page";
            visibleOverdue.forEach(el => page.appendChild(el));
            const donuts = clone.querySelector(".donut-section");
            if (donuts && donuts.parentNode) {
                donuts.parentNode.insertBefore(page, donuts.nextSibling);
            } else {
                clone.appendChild(page);
            }
        }

        // Dropping the filters panel also dropped every trace of which period
        // and which employee the numbers cover, leaving an unidentifiable
        // sheet. Restate the active filters as a printed caption instead.
        const period = (this.filters.from_date && this.filters.to_date)
            ? `${this.format_date(this.filters.from_date)} — ${this.format_date(this.filters.to_date)}`
            : "كل الفترات";
        const criteria = [`الفترة: ${period}`];
        if (this.filters.employee) {
            criteria.push(`الموظف: ${this.filters.employee}`);
        }
        if (this.filters.loan_product) {
            criteria.push(`نوع السلفة: ${this.product_name(this.filters.loan_product)}`);
        }

        const caption = document.createElement("div");
        caption.className = "print-caption";
        caption.textContent = `${criteria.join("   •   ")}   •   تاريخ الطباعة: ${this.format_date(frappe.datetime.now_date())}`;
        clone.insertBefore(caption, clone.firstChild);

        // Carry the stylesheets across; skip <script> so nothing re-executes.
        // Order matters (later rules win), so keep them in document order.
        let styles = "";
        document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => {
            styles += node.outerHTML;
        });

        const win = window.open("", "_blank", "width=1280,height=900");
        if (!win) {
            frappe.msgprint(__("يرجى السماح بالنوافذ المنبثقة لطباعة التقرير"));
            return;
        }

        const today = frappe.datetime.now_date();

        win.document.open();
        win.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<!-- The window is about:blank, so every relative URL carried over in the
     stylesheets -- font files, background images, the asset bundles -- would
     resolve against nothing and silently 404. The base tag anchors them all
     back to the desk. -->
<base href="${document.baseURI}">
<title>Advance Dashboard - ${today}</title>
${styles}
<style>
    /* نسخة الطباعة: صفحة مستقلة بلا أي عناصر من واجهة Frappe،
       لذلك لا حاجة لإخفاء أشرطة أو إعادة ضبط حاويات. */
    @page { size: A4 ${orientation}; margin: 10mm 8mm; }

    html, body {
        background: #ffffff !important;
        margin: 0 !important;
        padding: 0 !important;
        direction: rtl;
        font-size: 9pt;
    }
    .print-root { width: 100%; padding: 0; }

    .print-chart-img {
        width: 100% !important;
        height: auto !important;
        display: block;
    }

    .print-caption {
        font-size: 8.5pt;
        font-weight: 700;
        color: #0f172a;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 6px 10px;
        margin: 0 0 10px 0;
        text-align: center;
        page-break-after: avoid;
        break-after: avoid;
    }

    /* ===== تقسيم الصفحات =====
       صفحة 1: العنوان + البطاقات الكبيرة + الصغيرة
       صفحة 2: رسم الأعمدة + الدائرتان
       صفحة 3: المتأخرات (إن كانت مفتوحة)
       ثم صفحة لكل موظف.
       كل فاصل هو page-break-before فقط — لا يوجد أي page-break-after،
       لأن فاصلاً بعد كتلة وفاصلاً قبل التي تليها يُنتجان صفحة بيضاء
       بينهما. */
    .dashboard-header, .main-cards, .small-stat-grid {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
    }

    .analytics-card {
        page-break-before: always !important;
        break-before: page !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
    }
    .donut-section {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
    }
    /* رسم الأعمدة والدائرتان في صفحة واحدة: الصورة تتقلّص بنسبتها محفوظة
       (العرض والارتفاع تلقائيان مع حدّ أقصى لكليهما)، لأن تثبيت الارتفاع
       وحده مع عرض 100% كان يسحق الرسم أفقياً. */
    .analytics-card .print-chart-img {
        width: auto !important;
        height: auto !important;
        max-width: 100% !important;
        max-height: ${isPortrait ? "70mm" : "88mm"} !important;
        margin: 0 auto !important;
    }
    .donut-box svg, .donut-box .print-chart-img {
        max-height: ${isPortrait ? "48mm" : "58mm"} !important;
        width: auto !important;
        height: auto !important;
    }

    .print-overdue-page {
        page-break-before: always !important;
        break-before: page !important;
    }
    /* جدول المتأخرات جزء من صفحة المتأخرات لا صفحة مستقلة: صفوفه تحمل
       صنف .employee-dashboard-container الذي يفرض فاصلاً قبل كل موظف. */
    .print-overdue-page .employee-dashboard-container,
    .overdue-table-block {
        page-break-before: avoid !important;
        break-before: auto !important;
    }

    .employees-section {
        page-break-before: always !important;
        break-before: page !important;
    }
    /* عنوان القسم يبقى ملتصقاً بأول موظف بدل أن يتيتّم في آخر صفحة */
    .employees-section > .section-title {
        page-break-after: avoid !important;
        break-after: avoid !important;
    }

    /* أي overflow مخفي يقصّ المحتوى ويُفسد ترقيم الصفحات */
    .loan-table-scroll, .table-responsive,
    .employee-dashboard-container, .card-section,
    .employees-container, .overdue-details-section {
        overflow: visible !important;
        max-width: 100% !important;
    }

    /* table-layout:auto لا fixed: الأعمدة تتمدد حسب محتواها فلا يُقصّ
       أي عنوان. مع fixed كانت العناوين العربية تُختصر إلى أول حرفين. */
    .loan-detail-table, .custom-hover-table, table {
        min-width: 0 !important;
        width: 100% !important;
        table-layout: auto !important;
        font-size: 7.5pt !important;
        border-collapse: collapse !important;
    }
    .loan-detail-table colgroup, .custom-hover-table colgroup {
        display: none !important;
    }

    /* العناوين تلتف بالكامل بدل أن تُقصّ */
    table th, table td,
    .custom-hover-table thead th,
    .loan-detail-table th, .loan-detail-table td {
        white-space: normal !important;
        overflow: visible !important;
        text-overflow: clip !important;
        overflow-wrap: break-word !important;
        word-break: normal !important;
        padding: 4px 5px !important;
        vertical-align: middle !important;
    }
    .custom-hover-table thead th {
        font-size: 7.5pt !important;
        line-height: 1.35 !important;
        font-weight: 700 !important;
        color: #000 !important;
    }

    /* بطاقة الموظف قد تتجاوز الصفحة (بعض الموظفين لديهم 16 سلفة)، فلا
       يمكن منع انقسامها كلياً -- المتصفح سيتجاهل المنع ويقطعها عشوائياً.
       الحل: وحدتان مستقلتان، كل واحدة غير قابلة للانقسام:
       (1) الملف الشخصي + جدول السلف   (2) خطة السداد السنوية
       فإن لم تتسعا معاً، تنتقل الثانية إلى الصفحة التالية كاملة. */
    .employee-main-row,
    .employee-annual-row {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
    }
    tr, thead, .annual-loan-block, .card-section,
    .employee-profile-card, .table-responsive,
    .overdue-card, .overdue-chart-box {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
    }
    .employee-dashboard-container table {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
    }
    .employee-annual-row {
        margin-top: 10px !important;
    }
    thead { display: table-header-group !important; }

    .employee-dashboard-container {
        page-break-inside: auto !important;
        break-inside: auto !important;
        page-break-before: always;
        box-shadow: none !important;
        margin-bottom: 0 !important;
        padding: 10px !important;
    }
    .employee-dashboard-container:first-of-type { page-break-before: avoid; }

    /* جدول المتأخرات وحده يُسمح بتقسيمه على مستوى الصفوف */
    .overdue-table-block table {
        page-break-inside: auto !important;
        break-inside: auto !important;
    }

    /* الشبكة: تسمح بالالتفاف حتى لا تُجبَر الأعمدة على البقاء في سطر
       واحد أطول من الصفحة */
    .employee-dashboard-container .row {
        display: flex !important;
        flex-wrap: wrap !important;
        break-inside: auto !important;
    }
    .employee-dashboard-container .col-md-3 { flex: 0 0 25%  !important; max-width: 25%  !important; }
    .employee-dashboard-container .col-md-9 { flex: 0 0 75%  !important; max-width: 75%  !important; }
    .employee-dashboard-container .col-md-8 { flex: 0 0 66.6% !important; max-width: 66.6% !important; }
    .employee-dashboard-container .col-md-4 { flex: 0 0 33.3% !important; max-width: 33.3% !important; }
    /* col-md-2 هو العرض الوحيد الذي لم يكن له مقابل هنا. صفّ صندوق
       «الإجمالي الكلي للسلفة السنوية» يستعمله لخانات مبلغ/مدفوع/متبقي،
       فبقيت بعرضها الافتراضي (col-4 = ثلث الصف) والتفّت خانتا «متبقي»
       و«أقساط» إلى سطر ثانٍ -- وهذا السطر الثاني هو ما كان يسقط في
       الصفحة التالية. 25% + 16.6%×3 + 25% ≈ صفّ واحد تماماً. */
    .employee-dashboard-container .col-md-2 { flex: 0 0 16.6% !important; max-width: 16.6% !important; }

    /* الرسوم الدائرية لكل موظف تُصغَّر حتى لا تدفع البطاقة لصفحة ثانية.
       الصورة تأخذ الارتفاع فقط وعرضها تلقائي، وإلا انسحقت الدائرة بيضاوياً
       لأن قاعدة العرض 100% كانت تُطبَّق مع ارتفاع ثابت. */
    .chart-wrapper, .chart-wrapper > div {
        height: 95px !important;
        max-height: 95px !important;
    }
    .chart-wrapper img {
        height: 95px !important;
        max-height: 95px !important;
        width: auto !important;
        max-width: 100% !important;
        margin: 0 auto !important;
    }

${isPortrait ? `
    /* الوضع العمودي: عرض الصفحة أضيق بكثير، فتُرصّ الأعمدة فوق بعضها
       ويُصغَّر الخط حتى تبقى الجداول مقروءة دون قصّ. */
    .employee-dashboard-container .col-md-3,
    .employee-dashboard-container .col-md-9,
    .employee-dashboard-container .col-md-8,
    .employee-dashboard-container .col-md-4 {
        flex: 0 0 100% !important;
        max-width: 100% !important;
    }
    .employee-dashboard-container .row {
        flex-direction: column !important;
    }
    table, .loan-detail-table, .custom-hover-table {
        font-size: 6.5pt !important;
    }
    th, td { padding: 3px 4px !important; }
    .overdue-section, .overdue-cards {
        grid-template-columns: 1fr !important;
    }
    .donut-section { flex-direction: column !important; }
    .main-cards, .small-stat-grid {
        grid-template-columns: repeat(2, 1fr) !important;
    }
` : ``}

    /* ===== ضغط المقاسات للورق =====
       المقاسات الأصلية مصممة للشاشة: بطاقة بارتفاع 100px وحشوة 25px،
       وحاوية رسم بارتفاع 340px. مجموعها يتجاوز الـ 190mm المتاحة رأسياً
       في A4 الأفقي، فكانت كل كتلة تُدفع إلى صفحة وحدها: البطاقات الصغيرة
       في صفحة، الرسم في صفحة، الدوائر في ثالثة. القواعد التالية تُنقص
       الحشوات والخطوط حتى تتسع كل مجموعة في صفحتها المقصودة.
       موضعها آخر البلوك عمداً: تتغلب على قواعد !important الأسبق
       المتساوية معها في الأولوية. */

    /* --- صفحة 1: العنوان + البطاقات الكبيرة + الصغيرة ---
       المقاسات مضبوطة لتملأ الـ 190mm المتاحة تقريباً (≈170mm) بدل أن
       تنكمش في نصف الصفحة، مع هامش أمان يمنع انزلاق البطاقات الصغيرة
       إلى صفحة ثانية. */
    .dashboard-header {
        padding: 16px 20px !important;
        margin-bottom: 12px !important;
        border-radius: 12px !important;
        box-shadow: none !important;
    }
    .dashboard-header h1 { font-size: 21pt !important; margin: 0 !important; }
    .dashboard-header p  { font-size: 10.5pt !important; margin: 4px 0 0 0 !important; }
    .dashboard-header .header-icon { font-size: 26pt !important; }

    .main-cards, .small-stat-grid {
        gap: 12px !important;
        margin-bottom: 12px !important;
    }
    .main-cards      { grid-template-columns: repeat(${isPortrait ? 2 : 4}, 1fr) !important; }
    .small-stat-grid { grid-template-columns: repeat(${isPortrait ? 3 : 6}, 1fr) !important; }

    .main-card {
        padding: 18px 18px !important;
        min-height: 0 !important;
        border-radius: 14px !important;
        box-shadow: none !important;
    }
    .small-stat-card {
        padding: 16px 16px !important;
        min-height: 0 !important;
        border-radius: 14px !important;
        box-shadow: none !important;
        gap: 12px !important;
    }
    .main-card .card-icon {
        width: 46px !important;
        height: 46px !important;
        font-size: 21pt !important;
        border-radius: 13px !important;
        margin-bottom: 12px !important;
    }
    .small-stat-card .pulse-circle {
        width: 40px !important;
        height: 40px !important;
        min-width: 40px !important;
        font-size: 18pt !important;
        border-radius: 12px !important;
    }
    .card-title, .small-stat-title { font-size: 11pt !important; }
    .card-value                    { font-size: 20pt !important; margin: 8px 0 !important; }
    .small-stat-value              { font-size: 17pt !important; margin-top: 4px !important; }
    .card-desc                     { font-size: 8.5pt !important; line-height: 1.5 !important; }

    /* --- صفحة 2: رسم الأعمدة + الدائرتان --- */
    .analytics-card, .donut-box, .overdue-card, .overdue-chart-box {
        padding: 16px !important;
        border-radius: 12px !important;
        box-shadow: none !important;
        margin-bottom: 12px !important;
    }
    .analytics-header h2 { font-size: 15pt !important; margin: 0 !important; }
    .analytics-header p  { font-size: 9.5pt !important; margin: 3px 0 10px 0 !important; }

    /* حاوية الرسم ذات الارتفاع الثابت (340px) كانت تحجز مساحتها كاملة
       حتى بعد تصغير الصورة بداخلها، فتُزاح الدوائر إلى صفحة تالية. */
    .main-chart-area, .combo-chart-wrap, .aging-chart-wrap {
        height: auto !important;
        min-height: 0 !important;
    }
    .analytics-card .print-chart-img {
        max-height: ${isPortrait ? "70mm" : "88mm"} !important;
    }
    .donut-section { gap: 14px !important; margin-bottom: 0 !important; }
    .donut-box h3  { font-size: 13pt !important; margin: 0 0 8px 0 !important; }
    .donut-info    { font-size: 9.5pt !important; line-height: 1.7 !important; }
    /* الدائرتان SVG بارتفاع 250px (≈66mm) وبلا viewBox، فأي max-height
       عليهما يقصّ الرسم بدل أن يصغّره. تُترك بمقاسها -- المساحة تكفي
       بعد تصغير رسم الأعمدة أعلاه. */

    /* --- صفحة الموظف: كل ما يخصه مع خطة السداد السنوية في نفس الصفحة ---
       خطة السداد كانت وحدة «غير قابلة للانقسام» مستقلة، فإن لم يتبقَّ لها
       مكان أسفل جدول السلف قفزت بكاملها إلى صفحة تالية وتركت نصف الصفحة
       فارغاً. الآن تنساب مباشرة خلف الجدول: إن اتسعت بقيت مع الموظف، وإن
       لم تتسع انقسمت عند حدود الصفوف بدل أن تُنقل كتلةً واحدة.
       والحاوية نفسها قابلة للانسياب لأن فرض avoid على كتلة أطول من الصفحة
       يتجاهله المتصفح ويقطعها عشوائياً. */
    .employee-dashboard-container {
        page-break-inside: auto !important;
        break-inside: auto !important;
        padding: 12px !important;
        border-radius: 10px !important;
    }
    .employee-annual-row,
    .employee-annual-row .row,
    .employee-annual-row .card-section,
    .employee-annual-row .annual-loan-block,
    .employee-annual-row .table-responsive,
    .employee-annual-row table {
        page-break-inside: auto !important;
        break-inside: auto !important;
    }
    .employee-annual-row { margin-top: 10px !important; }
    /* الملف الشخصي وجدول السلف يبقيان معاً -- انقسامهما هو ما يجعل
       الصفحة تُقرأ كبطاقتين لموظفين مختلفين. */
    .employee-main-row {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
    }
    .employee-dashboard-container table {
        font-size: ${isPortrait ? "7pt" : "8pt"} !important;
    }
    .employee-dashboard-container th,
    .employee-dashboard-container td {
        padding: 4px 6px !important;
        line-height: 1.45 !important;
    }
    .employee-profile-card, .card-section {
        padding: 11px !important;
        border-radius: 9px !important;
        box-shadow: none !important;
    }
    .card-section h6, .table-heading-row h6 {
        font-size: 10.5pt !important;
        margin: 0 0 7px 0 !important;
    }

    /* وحتى لو ضاقت المساحة، صندوق الإجمالي ينتقل كاملاً لا يُقطع نصفين. */
    .employee-annual-row .card-section > div:last-child {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
    }

    /* رسم تقدّم السداد: قاعدة الـ 95px أعلاه كانت تقصّ الـ SVG لا تصغّره،
       لأن frappe-charts يولّده بلا viewBox. أُعطي viewBox قبل الطباعة،
       فصار يتقلّص بنسبته محفوظة داخل نفس المساحة تماماً -- بلا زيادة في
       ارتفاع البطاقة. */
    .employee-annual-row .chart-wrapper svg {
        display: block !important;
        width: auto !important;
        height: auto !important;
        max-width: 100% !important;
        max-height: 25mm !important;
        margin: 0 auto !important;
    }
    /* قيم الدائرة تظهر في frappe-charts عند مرور المؤشر فقط، ولا مؤشر
       على الورق -- هذا السطر بديلها المطبوع. */
    .payment-print-legend {
        display: flex !important;
        justify-content: center !important;
        gap: 12px !important;
        margin-top: 4px !important;
        font-size: 8pt !important;
        font-weight: 700 !important;
        color: #0f172a !important;
    }
    .payment-print-legend i {
        display: inline-block !important;
        width: 8px !important;
        height: 8px !important;
        border-radius: 2px !important;
        margin-left: 4px !important;
    }

    * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }
</style>
</head>
<body><div class="print-root">${clone.outerHTML}</div></body>
</html>`);
        win.document.close();

        // Wait for the page to be genuinely ready instead of guessing with a
        // fixed delay: the desk stylesheet bundle is large, and printing before
        // it applies produced an unstyled sheet, while printing before the
        // chart PNGs decoded produced blank chart boxes. The race guard keeps a
        // single stalled asset from blocking the dialog forever.
        this.when_print_ready(win, 10000).then(() => {
            win.focus();
            win.print();
        });

        // Chrome keeps the tab open after the dialog closes; the user had to
        // dismiss a stack of leftover tabs after each print.
        win.addEventListener("afterprint", () => win.close());
    }

    // Resolves once every stylesheet, image and font in `win` has settled
    // (loaded OR failed -- a failed asset must not stall the print), or once
    // `timeout` ms have passed, whichever comes first.
    when_print_ready(win, timeout) {
        const settled = (node, done) => done
            ? Promise.resolve()
            : new Promise(resolve => {
                node.addEventListener("load", resolve, { once: true });
                node.addEventListener("error", resolve, { once: true });
            });

        const ready = new Promise(resolve => {
            const collect = () => {
                const doc = win.document;
                const waits = [];

                doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                    // A parsed sheet exposes .sheet; until then it is still loading.
                    waits.push(settled(link, !!link.sheet));
                });
                doc.querySelectorAll("img").forEach(img => {
                    waits.push(settled(img, img.complete));
                });
                if (doc.fonts && doc.fonts.ready) {
                    waits.push(doc.fonts.ready);
                }

                Promise.all(waits).then(resolve, resolve);
            };

            if (win.document.readyState === "complete") {
                collect();
            } else {
                win.addEventListener("load", collect, { once: true });
            }
        });

        return Promise.race([
            ready,
            new Promise(resolve => setTimeout(resolve, timeout))
        ]);
    }

    status_label(status) {
        // Two states only: settled or still being repaid.
        return status === "Closed" ? "مكتمل" : "جاري السداد";
    }

    product_name(product) {
        let clean = product || "-";
        if (clean.includes("-")) {
            clean = clean.split("-")[1] || clean;
        }
        return clean.trim();
    }

    // نوع السلفة يُعرض داخل شارة ملونة تفصله بصرياً عن باقي النص:
    // سنوية / شهرية / الشطفة / غير ذلك
    product_cell(product) {
        const name = this.product_name(product);
        let cls = "type-other";
        if (name.includes("سنوية")) {
            cls = "type-annual";
        } else if (name.includes("شهرية")) {
            cls = "type-monthly";
        } else if (name.includes("شطف")) {
            cls = "type-shatfa";
        }
        return `<span class="loan-type-badge ${cls}">${name}</span>`;
    }
    

    // التسميات مشتركة بين رسمَي الفترة، فتُبنى مرة واحدة هنا.
    // يعيد: labels (تاريخ كامل، للتلميح) و axis_labels (اسم الشهر مرة واحدة، للمحور).
    month_chart_labels(data) {
        const arabic_months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

        // الباك-إند يرسل مفاتيح ISO: "2026-01-15" للتجميع اليومي و"2026-01" للشهري.
        // كلاهما يحمل السنة، فلم تعد شهور سنتين مختلفتين تندمج في عمود واحد.
        const keys = (data.labels || []).map(key => String(key).split("-"));

        // التاريخ الكامل يبقى في التلميح فقط.
        const labels = keys.map(parts => {
            const month = arabic_months[parseInt(parts[1], 10) - 1] || parts[1];
            if (parts.length === 3) return `${parts[2]} ${month} ${parts[0]}`;
            if (parts.length === 2) return `${month} ${parts[0]}`;
            return parts.join("-");
        });

        // المحور السفلي لا يحمل تواريخ: اسم الشهر يُكتب مرة واحدة عند أول عمود
        // فيه، وبقية أعمدة الشهر بلا تسمية. هذا يمنع صفّ التواريخ المائل
        // المزدحم ويترك محوراً نظيفاً يُقرأ كفترات لا كنقاط.
        const axis_labels = keys.map((parts, i) => {
            const prev = i > 0 ? keys[i - 1] : null;
            const same_month = prev && prev[0] === parts[0] && prev[1] === parts[1];
            if (same_month) return "";

            const month = arabic_months[parseInt(parts[1], 10) - 1] || parts[1];
            // السنة تُذكر فقط عند تغيّرها حتى لا تتكرر على كل شهر.
            const new_year = !prev || prev[0] !== parts[0];
            return new_year ? `${month} ${parts[0]}` : month;
        });

        return { labels, axis_labels };
    }

    // إعدادات مشتركة للمحور السفلي في رسمَي الفترة.
    month_x_scale(axis_labels) {
        return {
            grid: { display: false },
            border: { color: "#cbd5e1" },
            ticks: {
                color: "#475569",
                font: { size: 11.5, weight: "600" },
                // التسميات مُحسوبة مسبقاً (اسم الشهر مرة واحدة)، فيجب تعطيل
                // التخطي التلقائي وإلا حذف Chart.js بالضبط التسميات القليلة
                // التي نريد إظهارها.
                autoSkip: false,
                maxRotation: 0,
                minRotation: 0,
                callback: (value, index) => axis_labels[index] || ""
            }
        };
    }

    month_legend() {
        return {
            position: "top",
            align: "end",
            labels: {
                usePointStyle: true,
                pointStyle: "rectRounded",
                boxWidth: 10,
                boxHeight: 10,
                padding: 16,
                font: { size: 11.5, weight: "600" },
                color: "#334155"
            }
        };
    }

    render_month_chart() {
        let data = this.data.monthly_chart;
        const mainContainer = document.getElementById("monthly-loan-chart");

        if (!data || !mainContainer) return;

        const { labels, axis_labels } = this.month_chart_labels(data);

        // رسم واحد: عمودان لكل شهر (سلف / مدفوع) ومنحنى مظلَّل فوقهما
        // لعدد الطلبات.
        mainContainer.innerHTML = `<div class="combo-chart-wrap"><canvas id="monthly-combo-canvas"></canvas></div>`;

        if (this.charts.month_combo) {
            this.charts.month_combo.destroy();
        }

        const ctx = document.getElementById("monthly-combo-canvas").getContext("2d");
        const applicants = data.applicant_counts || data.counts || [];
        const counts = (data.counts || []).map(v => Number(v) || 0);

        // مظهر رسمي: ألوان مصمتة بدل التدرجات اللامعة، وأعمدة أنحف متلاصقة
        // داخل المجموعة الواحدة. المنحنى بأحمر — لون مقابل تماماً لعائلة
        // الفيروزي والأخضر، فلا يذوب في الأعمدة التي يمر فوقها.
        const COLOR_LOAN = "#0e8fa3";
        const COLOR_PAID = "#1e9e68";
        const COLOR_TREND = "#c0392b";

        const currencyFmt = (v) => this.currency(v);

        // ظل ناعم تحت خط المنحنى وحده: يُفعَّل قبل رسم تلك المجموعة ويُلغى
        // بعدها، وإلا ورث كل عمود نفس الظل وبدت اللوحة ضبابية. طبقة التظليل
        // مستثناة أيضاً — ظل على تدرّج شفاف يجعل حافته متسخة.
        const CURVE_DATASET = "عدد الطلبات";
        const is_curve = (chart, args) =>
            (chart.data.datasets[args.index] || {}).label === CURVE_DATASET;

        const curve_shadow = {
            id: "curveShadow",
            beforeDatasetDraw(chart, args) {
                if (!is_curve(chart, args)) return;
                const c = chart.ctx;
                c.save();
                c.shadowColor = "rgba(192, 57, 43, 0.30)";
                c.shadowBlur = 12;
                c.shadowOffsetY = 5;
            },
            afterDatasetDraw(chart, args) {
                if (!is_curve(chart, args)) return;
                chart.ctx.restore();
            }
        };

        const legend = this.month_legend();
        legend.labels.filter = (item) => item.text !== "_curve_fill";

        this.charts.month_combo = new Chart(ctx, {
            plugins: [curve_shadow],
            data: {
                labels: labels,
                datasets: [
                    // الظل مفصول عن الخط في مجموعتين متطابقتي البيانات:
                    // المساحة المظلَّلة تُرسم خلف الأعمدة (order أكبر) فتبقى
                    // الأعمدة صافية غير مغطاة بطبقة حمراء، والخط نفسه يُرسم
                    // فوق الجميع (order أصغر) فيظل واضحاً. مجموعة واحدة لا
                    // تستطيع ذلك — الظل والخط فيها طبقة واحدة.
                    {
                        type: "line",
                        label: "_curve_fill",
                        data: counts,
                        yAxisID: "yCount",
                        order: 9,
                        borderWidth: 0,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        tension: 0.35,
                        fill: "origin",
                        // التدرّج يحتاج أبعاد منطقة الرسم، وهي غير معروفة قبل
                        // أول تخطيط — لذلك دالة لا قيمة ثابتة، فيُعاد بناؤه مع
                        // كل تغيير في الحجم بدل أن تتمدد صورة قديمة.
                        backgroundColor: (context) => {
                            const { ctx: c, chartArea } = context.chart;
                            if (!chartArea) return "rgba(192, 57, 43, 0.14)";
                            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            g.addColorStop(0, "rgba(192, 57, 43, 0.30)");
                            g.addColorStop(0.55, "rgba(192, 57, 43, 0.11)");
                            g.addColorStop(1, "rgba(192, 57, 43, 0)");
                            return g;
                        }
                    },
                    {
                        type: "line",
                        label: "عدد الطلبات",
                        data: counts,
                        yAxisID: "yCount",
                        order: 0,
                        borderColor: COLOR_TREND,
                        borderWidth: 2.5,
                        // انحناء معتدل: يكفي ليبدو منحنى لا خطوطاً مكسّرة،
                        // ولا يبالغ فيتجاوز القيم الحقيقية بين كل نقطتين.
                        tension: 0.35,
                        fill: false,
                        pointRadius: 3.5,
                        pointHoverRadius: 7,
                        pointBackgroundColor: "#ffffff",
                        pointBorderColor: COLOR_TREND,
                        pointBorderWidth: 2
                    },
                    {
                        type: "bar",
                        label: "مبلغ السلفة",
                        data: data.loan_amounts || [],
                        yAxisID: "yAmount",
                        order: 1,
                        backgroundColor: COLOR_LOAN,
                        hoverBackgroundColor: "#0a7182",
                        borderRadius: 2,
                        borderSkipped: false,
                        maxBarThickness: 22
                    },
                    {
                        type: "bar",
                        label: "المبلغ المدفوع",
                        data: data.paid_amounts || [],
                        yAxisID: "yAmount",
                        order: 2,
                        backgroundColor: COLOR_PAID,
                        hoverBackgroundColor: "#178053",
                        borderRadius: 2,
                        borderSkipped: false,
                        maxBarThickness: 22
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                layout: { padding: { top: 10, bottom: 4 } },
                // أعمدة أنحف ومتلاصقة داخل المجموعة، وفراغ أوسع بين المجموعات.
                barPercentage: 0.92,
                categoryPercentage: 0.72,
                plugins: {
                    // طبقة التظليل مجرد وسيلة رسم، لا بيان مستقل — تُخفى من
                    // وسيلة الإيضاح ومن التلميح وإلا ظهر «عدد الطلبات» مرتين.
                    legend: legend,
                    tooltip: {
                        backgroundColor: "rgba(15, 23, 42, 0.94)",
                        padding: 13,
                        cornerRadius: 10,
                        titleFont: { size: 13, weight: "700" },
                        bodyFont: { size: 12 },
                        bodySpacing: 6,
                        displayColors: true,
                        usePointStyle: true,
                        filter: (item) => item.dataset.label !== "_curve_fill",
                        callbacks: {
                            label(context) {
                                if (context.dataset.yAxisID === "yCount") {
                                    return ` ${context.dataset.label}: ${context.parsed.y} طلب`;
                                }
                                return ` ${context.dataset.label}: ${currencyFmt(context.parsed.y)}`;
                            },
                            footer(items) {
                                const idx = items.length ? items[0].dataIndex : -1;
                                const n = idx >= 0 ? (applicants[idx] || 0) : 0;
                                return `عدد المتقدمين: ${n} موظف`;
                            }
                        },
                        footerFont: { size: 12, weight: "600" },
                        footerColor: "#fbbf24"
                    }
                },
                scales: {
                    x: this.month_x_scale(axis_labels),
                    yAmount: {
                        position: "right",
                        grace: "8%",
                        beginAtZero: true,
                        border: { display: false },
                        grid: {
                            color: "#eef2f7",
                            drawTicks: false
                        },
                        ticks: {
                            color: "#64748b",
                            font: { size: 11 },
                            padding: 8,
                            callback: (value) => {
                                if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + "M";
                                if (Math.abs(value) >= 1000) return (value / 1000).toFixed(0) + "K";
                                return value;
                            }
                        }
                    },
                    // محور مستقل للعدد: الطلبات عشرات والمبالغ ملايين، فعلى
                    // محور واحد يلتصق المنحنى بالقاع خطاً مسطحاً. الهامش
                    // الواسع (grace) يرفع المنحنى فوق قمم الأعمدة بدل أن
                    // يتقاطع معها.
                    yCount: {
                        position: "left",
                        beginAtZero: true,
                        grace: "45%",
                        border: { display: false },
                        // شبكتان متداخلتان تشوّشان القراءة؛ شبكة المبالغ تكفي.
                        grid: { drawOnChartArea: false, drawTicks: false },
                        title: {
                            display: true,
                            text: "عدد الطلبات",
                            color: COLOR_TREND,
                            font: { size: 11, weight: "700" }
                        },
                        ticks: {
                            color: "#94a3b8",
                            font: { size: 11 },
                            padding: 8,
                            precision: 0
                        }
                    }
                }
            }
        });
    }

    render_overdue_aging_chart() {
        let data = this.data.overdue_chart;
        const container = document.getElementById("overdue-aging-chart");
        if (!container) return;

        // القسم مطويّ: الرسم داخل حاوية بعرض وارتفاع صفر يخرج مشوَّهاً،
        // فنتركه حتى يفتحه المستخدم -- toggle_overdue_section يعيد النداء.
        if (!$("#overdue-section").is(":visible")) return;

        if (this.charts.overdue_aging) {
            this.charts.overdue_aging.destroy();
            this.charts.overdue_aging = null;
        }

        const amounts = (data && data.amounts) || [];
        const counts = (data && data.counts) || [];

        if (!amounts.length || amounts.every(v => !v)) {
            container.innerHTML = `<div class="no-data-alert">لا توجد سلف متأخرة حالياً</div>`;
            return;
        }

        // Buckets with no loans are dropped -- an axis of mostly-empty
        // categories reads as a broken chart.
        const labels = [];
        const plotAmounts = [];
        const plotCounts = [];
        (data.labels || []).forEach((label, i) => {
            if (amounts[i]) {
                labels.push(label);
                plotAmounts.push(amounts[i]);
                plotCounts.push(counts[i] || 0);
            }
        });

        container.innerHTML = `<div class="aging-chart-wrap"><canvas id="overdue-aging-canvas"></canvas></div>`;
        const ctx = document.getElementById("overdue-aging-canvas").getContext("2d");
        const currencyFmt = (v) => this.currency(v);

        this.charts.overdue_aging = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "المبلغ المتأخر",
                    data: plotAmounts,
                    backgroundColor: "#94a3b8",
                    hoverBackgroundColor: "#64748b",
                    borderRadius: 4,
                    borderSkipped: false,
                    maxBarThickness: 30
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: "y",
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "rgba(15, 23, 42, 0.94)",
                        padding: 12,
                        cornerRadius: 10,
                        callbacks: {
                            label(context) {
                                const n = plotCounts[context.dataIndex] || 0;
                                return ` ${currencyFmt(context.parsed.x)} — ${n} سلفة`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: "rgba(226, 232, 240, 0.75)", drawBorder: false },
                        ticks: {
                            color: "#64748b",
                            font: { size: 11 },
                            callback: (value) => {
                                if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + "M";
                                if (Math.abs(value) >= 1000) return (value / 1000).toFixed(0) + "K";
                                return value;
                            }
                        }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: "#475569", font: { size: 11, weight: "600" } }
                    }
                }
            }
        });
    }

    render_status_chart() {
        let data = this.data.status_chart;
        const statusContainer = document.getElementById("status-chart");
        const detailsContainer = document.getElementById("status-details");
        
        if (!data || !statusContainer) return;

        statusContainer.innerHTML = "";
        if (detailsContainer) detailsContainer.innerHTML = "";

        const status_translation = {
            "Disbursed": "تم الصرف",
            "Closed": "مغلق / مسدد",
            "Sanctioned": "موافق عليه",
            "Approved": "مقبول",
            "Pending": "قيد الانتظار",
            "Draft": "مسودة"
        };

        let labels = data.labels.map(label => status_translation[label] || label);
        const chartColors = ["#2ea66f", "#0891b2", "#e67b35", "#085683"];

        this.charts.status = new frappe.Chart(statusContainer, {
            title: "توزيع الحالات",
            data: {
                labels: labels,
                datasets: [{ values: data.values }]
            },
            type: "donut",
            height: 250,
            colors: chartColors
        });

        if (detailsContainer && data.details) {
            data.details.forEach((item, index) => {
                const translatedName = status_translation[item.name] || item.name;
                const percentage = item.percentage;
                const count = item.count;
                const color = chartColors[index % chartColors.length];

                const detailRow = `
                    <div class="status-detail-item">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="status-dot" style="background-color: ${color};"></span>
                            <span class="status-text">${translatedName}</span>
                        </div>
                        <span class="status-count">${count} طلب (${percentage}%)</span>
                    </div>
                `;
                detailsContainer.innerHTML += detailRow;
            });
        }
    }

    render_product_chart() {
        let data = this.data.loan_type_chart; 
        const typeContainer = document.getElementById("loan-type-chart");
        const detailsContainer = document.getElementById("loan-type-details") || document.getElementById("product-details");
        
        if (!data || !typeContainer) return;

        typeContainer.innerHTML = "";
        if (detailsContainer) detailsContainer.innerHTML = "";

        const chartColors = ["#0891b2", "#2ea66f", "#e67b35", "#a855f7", "#ec4899"];

        this.charts.product = new frappe.Chart(typeContainer, {
            title: "توزيع السلف حسب النوع",
            data: {
                labels: data.labels,
                datasets: [{ values: data.values }]
            },
            type: "donut",
            height: 250,
            colors: chartColors
        });

        if (detailsContainer && data.details) {
            data.details.forEach((item, index) => {
                const percentage = item.percentage;
                const count = item.count;
                const color = chartColors[index % chartColors.length];

                const detailRow = `
                    <div class="status-detail-item">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="status-dot" style="background-color: ${color};"></span>
                            <span class="status-text">${item.name}</span>
                        </div>
                        <span class="status-count">${count} طلب (${percentage}%)</span>
                    </div>
                `;
                detailsContainer.innerHTML += detailRow;
            });
        }
    }

    render_employees() {
        let container = $("#employees-container");
        if (!container.length) return;

        container.empty();

        let employees = this.data.employees_list || this.data.employees || [];

        if (!employees.length) {
            container.html(`
                <div class="no-data-alert">
                    لا توجد بيانات موظفين للفترة المحددة
                </div>
            `);
            return;
        }

        // 🎨 استايلات عصرية ومحسنة بشكل فاخر وكامل للواجهة
        if (!$("#custom-dashboard-styles").length) {
            $("head").append(`
                <style id="custom-dashboard-styles">
                    .employee-dashboard-container {
                        margin-bottom: 40px;
                        background: #ffffff;
                        border-radius: 18px;
                        padding: 26px;
                        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.03);
                        border: 1px solid #f1f5f9;
                        transition: all 0.3s ease;
                    }
                    .employee-dashboard-container:hover {
                        box-shadow: 0 15px 35px rgba(0, 0, 0, 0.06);
                    }
                    .employee-profile-card {
                        background: linear-gradient(145deg, #f8fafc, #f1f5f9);
                        border: 1px solid #e2e8f0;
                        border-radius: 16px;
                        padding: 26px;
                        height: 100%;
                    }
                    .card-section {
                        background: #ffffff;
                        border: 1px solid #e2e8f0;
                        border-radius: 16px;
                        padding: 26px;
                        box-shadow: 0 4px 14px rgba(0,0,0,0.01);
                        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease;
                    }
                    .card-section:hover {
                        transform: translateY(-3px);
                        box-shadow: 0 12px 28px rgba(0,0,0,0.06);
                    }
                    .custom-hover-table {
                        width: 100%;
                        vertical-align: middle;
                    }
                    .custom-hover-table thead th {
                        background-color: #f8fafc;
                        color: #000000;
                        font-weight: 700;
                        padding: 11px 12px;
                        border-bottom: 2px solid #cbd5e1;
                        font-size: 0.85rem;
                    }

                    /* نوع السلفة: لون نص مميز لكل نوع بدون خلفية أو إطار */
                    .loan-type-text {
                        font-weight: 700;
                    }
                    .loan-type-text.type-annual  { color: #7c3aed; }  /* سنوية */
                    .loan-type-text.type-monthly { color: #0d9488; }  /* شهرية */
                    .loan-type-text.type-other   { color: #64748b; }  /* الشطفة وغيرها */

                    /* الترميز اللوني داخل الجداول.
                       لا بد من رفع الأولوية هنا: القاعدة العامة
                       ".custom-hover-table tbody td" أولويتها أعلى من
                       ".amount-paid" وحدها، فكانت تلغي اللون. */
                    .custom-hover-table tbody td.amount-paid,
                    td.amount-paid,
                    .amount-paid {
                        color: #15803d !important;
                        font-weight: 700 !important;
                    }
                    .custom-hover-table tbody td.amount-remaining,
                    td.amount-remaining,
                    .amount-remaining {
                        color: #b91c1c !important;
                        font-weight: 700 !important;
                    }
                    /* يبقى اللون ظاهراً أثناء المرور على الصف */
                    .custom-hover-table tbody tr:hover td.amount-paid {
                        color: #15803d !important;
                    }
                    .custom-hover-table tbody tr:hover td.amount-remaining {
                        color: #b91c1c !important;
                    }
                    .custom-hover-table tbody td {
                        padding: 11px 12px;
                        border-bottom: 1px solid #f1f5f9;
                        color: #334155;
                        font-size: 0.85rem;
                    }
                    /* التمييز الوحيد هو تظليل رمادي فاتح عند مرور المؤشر */
                    .custom-hover-table tbody tr {
                        transition: background-color 0.15s ease;
                    }
                    .custom-hover-table tbody tr:hover td {
                        background-color: #f1f5f9;
                    }

                    /* جدول بعرض ثابت حتى لا يتمدد خارج البطاقة الحاوية */
                    .loan-detail-table {
                        table-layout: fixed;
                        width: 100%;
                        min-width: 760px;
                        margin-bottom: 0;
                    }
                    .loan-table-scroll {
                        border-radius: 12px;
                        border: 1px solid #e2e8f0;
                        overflow-x: auto;
                        overflow-y: hidden;
                        max-width: 100%;
                    }
                    /* الخلايا فقط تُختصر عند الضيق. أما العناوين فتلتف على
                       سطرين حتى تبقى مقروءة بالكامل. */
                    .loan-detail-table td {
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .loan-detail-table th,
                    .custom-hover-table thead th {
                        white-space: normal !important;
                        overflow: visible !important;
                        text-overflow: clip !important;
                        overflow-wrap: break-word;
                        line-height: 1.35;
                        vertical-align: middle;
                    }
                    .loan-detail-table .wrap-col {
                        white-space: normal;
                        word-break: break-word;
                    }
                    .num-col {
                        text-align: left;
                        direction: ltr;
                        font-variant-numeric: tabular-nums;
                    }
                    .date-col {
                        direction: ltr;
                        text-align: center;
                        font-variant-numeric: tabular-nums;
                    }
                    .table-heading-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 6px;
                    }
                    .table-count-badge {
                        background: #f1f5f9;
                        border: 1px solid #e2e8f0;
                        border-radius: 20px;
                        padding: 4px 12px;
                        font-size: 0.78rem;
                        font-weight: 700;
                        color: #475569;
                    }
                    .table-caption {
                        font-size: 0.8rem;
                        color: #94a3b8;
                        margin-bottom: 14px;
                        line-height: 1.6;
                    }
                    .progress-bar-container {
                        width: 100%;
                        height: 10px;
                        background-color: #e2e8f0;
                        border-radius: 20px;
                        overflow: hidden;
                    }
                    .progress-bar-fill {
                        height: 100%;
                        background: linear-gradient(90deg, #10b981, #34d399);
                        border-radius: 20px;
                        transition: width 0.8s ease-in-out;
                    }
                    .neutral-badge {
                        background-color: #f1f5f9 !important;
                        color: #1e293b !important;
                        border: 1px solid #e2e8f0;
                        font-weight: 700;
                    }
                    .completed-badge {
                        background-color: #dcfce7 !important;
                        color: #15803d !important;
                        border: 1px solid #bbf7d0;
                        font-weight: 700;
                    }
                    /* شريط التقدم: أخضر للسداد، وأخضر داكن عند الاكتمال */
                    .progress-bar-fill {
                        background: #22c55e !important;
                    }
                    .progress-bar-fill.is-complete {
                        background: #15803d !important;
                    }
                    .progress-percent-value {
                        font-size: 1.6rem;
                        font-weight: 800;
                        color: #0f172a;
                    }
                    .progress-percent-value.is-complete {
                        color: #15803d;
                    }
                    
                    .status-detail-item {
                        display: flex; 
                        justify-content: space-between; 
                        align-items: center; 
                        margin-bottom: 14px; 
                        font-size: 13px; 
                        direction: rtl;
                        padding: 8px 12px;
                        border-radius: 10px;
                        background: #f8fafc;
                        border: 1px solid #f1f5f9;
                    }
                    .status-dot {
                        display: inline-block; 
                        width: 10px; 
                        height: 10px; 
                        border-radius: 50%;
                    }
                    .status-text {
                        font-weight: 600; 
                        color: #475569;
                    }
                    .status-count {
                        color: #0f172a; 
                        font-weight: 700;
                    }
                    .info-badge-container {
                        display: flex;
                        gap: 12px;
                        margin-bottom: 16px;
                        flex-wrap: wrap;
                    }
                    .info-card-badge {
                        background: #f1f5f9;
                        border: 1px solid #e2e8f0;
                        border-radius: 8px;
                        padding: 8px 14px;
                        font-size: 0.85rem;
                        color: #334155;
                    }
                    .no-annual-loan-alert {
                        background-color: #f8fafc;
                        border: 2px dashed #cbd5e1;
                        border-radius: 14px;
                        padding: 34px;
                        text-align: center;
                        color: #64748b;
                        font-weight: 500;
                    }
                    .no-data-alert {
                        text-align:center; 
                        padding:40px; 
                        color:#64748b; 
                        font-weight:500;
                        background:#f8fafc;
                        border-radius:12px;
                    }
                </style>
            `);
        }

        employees.forEach(emp => {
            let empIdSafe = String(emp.name || emp.employee || Math.random()).replace(/[^a-zA-Z0-9]/g, "_");
            let firstLetter = emp.employee_name ? emp.employee_name.charAt(0).toUpperCase() : "M";

            let allLoans = emp.loans || [];
            
            let annualLoans = allLoans.filter(l => String(l.loan_product || '').includes('سنوية'));
            let hasAnnualLoan = annualLoans.length > 0; 

            let totalAnnualAmount = 0;
            let totalAnnualPaid = 0;
            let totalAnnualRemaining = 0;
            let totalInstallmentsCount = 0;
            let totalInstallmentValue = 0;

            let annualCardsHtml = "";

            if (hasAnnualLoan) {
                annualLoans.forEach((loan, idx) => {
                    let lAmount = parseFloat(loan.loan_amount || 0);
                    let lRemaining = parseFloat(loan.remaining || 0);
                    
                    let lPaid = loan.paid_amount ? parseFloat(loan.paid_amount) : (lAmount - lRemaining);
                    if (lPaid < 0) lPaid = 0;

                    // Both values come from the Loan record (repayment_periods /
                    // monthly_repayment_amount) and are reconciled server-side.
                    // If neither is set the loan genuinely has no schedule --
                    // show that rather than inventing an installment count.
                    let lInstallments = parseInt(loan.repayment_periods || 0);
                    let lMonthlyValue = parseFloat(loan.monthly_repayment_amount || 0);

                    totalAnnualAmount += lAmount;
                    totalAnnualPaid += lPaid;
                    totalAnnualRemaining += lRemaining;
                    totalInstallmentsCount += lInstallments;
                    totalInstallmentValue += lMonthlyValue;

                    annualCardsHtml += `
                        <div class="annual-loan-block mb-4" style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; background: #ffffff;">
                            <div class="info-badge-container">
                                <div class="info-card-badge"><strong>تاريخ السلفة:</strong> ${this.format_date(loan.posting_date)}</div>
                                <div class="info-card-badge"><strong>أساس التوزيع:</strong> أقساط شهرية منتظمة</div>
                                <div class="info-card-badge"><strong>تاريخ بداية الخصم:</strong> ${this.format_date(loan.repayment_start_date)}</div>
                            </div>
                            
                            <div class="table-responsive">
                                <table class="table custom-hover-table" style="margin-bottom: 0;">
                                    <thead>
                                        <tr>
                                            <th class="num-col">مبلغ السلفة</th>
                                            <th class="num-col">المدفوع</th>
                                            <th class="num-col">عدد الأقساط</th>
                                            <th class="num-col">قيمة القسط</th>
                                            <th class="num-col">نسبة الخصم</th>
                                            <th class="num-col">المتبقي</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td class="num-col">${this.currency(lAmount)}</td>
                                            <td class="num-col amount-paid">${this.currency(lPaid)}</td>
                                            <td class="num-col">${lInstallments ? lInstallments : "-"}</td>
                                            <td class="num-col">${lMonthlyValue ? this.currency(lMonthlyValue) : "-"}</td>
                                            <td class="num-col">${emp.deduction_percentage ? emp.deduction_percentage + "%" : "-"}</td>
                                            <td class="num-col amount-remaining">${this.currency(lRemaining)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `;
                });
            }

            let progressPercent = 0;
            if (totalAnnualAmount > 0) {
                progressPercent = Math.round((totalAnnualPaid / totalAnnualAmount) * 100);
            }
            if (progressPercent > 100) progressPercent = 100;

            let isComplete = progressPercent >= 100 && totalAnnualAmount > 0;
            let statusText = isComplete ? "مكتمل" : "جاري السداد";
            let statusClass = isComplete ? "completed-badge" : "neutral-badge";

            let bottomSectionHtml = "";
            if (hasAnnualLoan) {
                bottomSectionHtml = `
                    <div class="row g-4">
                        <div class="col-md-8">
                            <div class="card-section">
                                <div class="d-flex justify-content-between align-items-center mb-4">
                                    <h6 class="fw-bold mb-0" style="color: #334155; font-size:1.1rem;">خطة السداد للسلفة السنوية</h6>
                                    <span class="badge" style="font-size: 0.85rem; padding: 6px 14px; background-color: #ecfdf5; color: #065f46 !important; border: 1px solid #a7f3d0; border-radius:20px;">
                                        إجمالي السلف السنوية: ${annualLoans.length}
                                    </span>
                                </div>

                                ${annualCardsHtml}
                                
                                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-top: 15px;">
                                    <div class="row text-center fw-bold align-items-center" style="font-size: 0.9rem; color: #1e293b;">
                                        <div class="col-md-3 text-md-start mb-2 mb-md-0" style="color:#64748b;">الإجمالي الكلي للسلفة السنوية:</div>
                                        <div class="col-md-2 col-4 text-dark">مبلغ: <span style="display:block; color:#0f172a; font-size:1rem;">${this.currency(totalAnnualAmount)}</span></div>
                                        <div class="col-md-2 col-4">مدفوع: <span style="display:block; color:#15803d; font-size:1rem; font-weight:700;">${this.currency(totalAnnualPaid)}</span></div>
                                        <div class="col-md-2 col-4">متبقي: <span style="display:block; color:#b91c1c; font-size:1rem; font-weight:700;">${this.currency(totalAnnualRemaining)}</span></div>
                                        <div class="col-md-3 col-12 mt-2 mt-md-0 text-info">أقساط: <span style="display:block; color:#0891b2; font-size:1rem;">${totalInstallmentsCount} (${this.currency(totalInstallmentValue)}/ش)</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-4">
                            <div class="card-section text-center d-flex flex-column justify-content-center" style="height: 100%;">
                                <h6 class="fw-bold align-self-start mb-3" style="color: #334155;">تقدم السداد الإجمالي (السنوية)</h6>
                                
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <span class="progress-percent-value ${isComplete ? 'is-complete' : ''}">${progressPercent}%</span>
                                    <small class="badge ${statusClass}" style="padding: 6px 12px; border-radius: 20px; font-size:0.8rem;">${statusText}</small>
                                </div>

                                <div class="progress-bar-container mb-4">
                                    <div class="progress-bar-fill ${isComplete ? 'is-complete' : ''}" style="width: ${progressPercent}%;"></div>
                                </div>

                                <div class="chart-wrapper" style="position: relative; height: 140px; margin: 0 auto; width: 100%;">
                                    <div id="payment-${empIdSafe}" style="height: 140px;"></div>
                                </div>

                                <!-- قيم الدائرة تظهر في frappe-charts عند مرور المؤشر فقط،
                                     ولا مؤشر على الورق — فيُطبع هذا السطر بدلاً منها. -->
                                <div class="payment-print-legend print-only">
                                    <span><i style="background:#10b981;"></i>المدفوع: ${this.currency(totalAnnualPaid)}</span>
                                    <span><i style="background:#cbd5e1;"></i>المتبقي: ${this.currency(totalAnnualRemaining)}</span>
                                </div>

                                <div class="text-center mt-3">
                                    <small class="text-muted" style="font-size: 0.85rem; display:block; font-weight:500;">
                                        تم سداد ${this.currency(totalAnnualPaid)} من إجمالي ${this.currency(totalAnnualAmount)}
                                    </small>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                bottomSectionHtml = `
                    <div class="no-annual-loan-alert">
                        <i class="fa fa-info-circle" style="font-size: 24px; color: #94a3b8; margin-bottom: 10px; display: block;"></i>
                        لا توجد سلفة سنوية نشطة لهذا الموظف حالياً
                    </div>
                `;
            }

            container.append(`
                <div class="employee-dashboard-container" style="direction:rtl; text-align:right;">
                    <div class="row g-4 employee-main-row">
                        <div class="col-md-3">
                            <div class="employee-profile-card text-center">
                                <div style="width:80px; height:80px; background:linear-gradient(135deg, #0891b2, #06b6d4); color:white; font-size:32px; font-weight:bold; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:auto; box-shadow: 0 4px 14px rgba(8,145,178,0.25);">
                                    ${firstLetter}
                                </div>
                                <h5 class="mt-3 fw-bold" style="color: #0f172a; font-size:1.15rem;">${emp.employee_name || "-"}</h5>
                                <span class="badge bg-light text-muted mb-4" style="border:1px solid #e2e8f0; border-radius:6px; padding:5px 10px;">${emp.name || ""}</span>
                                <hr style="border-top: 1px dashed #cbd5e1; margin: 15px 0;">
                                <div class="text-end" style="font-size: 0.9rem;">
                                    <small class="text-muted" style="display:block; margin-bottom:2px;">الإدارة / القسم</small>
                                    <p class="fw-bold" style="color: #334155; margin-bottom:12px;">${emp.department || "-"}</p>
                                    <small class="text-muted" style="display:block; margin-bottom:2px;">الراتب الأساسي</small>
                                    <p class="fw-bold" style="font-size:1.05rem; margin-bottom:0; color:#334155;">${this.currency(emp.base_salary || 0)}</p>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-9">
                            <div class="card-section mb-4">
                                <div class="table-heading-row">
                                    <h6 class="fw-bold mb-0" style="color: #334155; font-size:1.1rem;">تفاصيل السلف الحالية والسابقة</h6>
                                    <span class="table-count-badge">${allLoans.length} سلفة</span>
                                </div>
                                <p class="table-caption">كل صف يمثل سلفة واحدة. "المتبقي" = مبلغ السلفة ناقص ما تم سداده. "المتأخر" = أقساط استحقت ولم تُسدَّد حتى تاريخه.</p>
                                <div class="table-responsive loan-table-scroll">
                                    <table class="table custom-hover-table loan-detail-table">
                                        <colgroup>
                                            <col style="width:12%;">
                                            <col style="width:11%;">
                                            <col style="width:13%;">
                                            <col style="width:11%;">
                                            <col style="width:7%;">
                                            <col style="width:11%;">
                                            <col style="width:12%;">
                                            <col style="width:11%;">
                                            <col style="width:12%;">
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th class="num-col">مبلغ السلفة</th>
                                                <th class="date-col">تاريخ السلفة</th>
                                                <th>نوع السلفة</th>
                                                <th class="date-col">بداية الخصم</th>
                                                <th class="num-col">الأقساط</th>
                                                <th class="num-col">قيمة القسط</th>
                                                <th class="num-col">المدفوع</th>
                                                <th class="num-col">المتبقي</th>
                                                <th>الحالة</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${allLoans.map(loan => {
                                                let lAmount = parseFloat(loan.loan_amount || 0);
                                                let lRemaining = parseFloat(loan.remaining || 0);
                                                let lPaid = loan.paid_amount ? parseFloat(loan.paid_amount) : (lAmount - lRemaining);
                                                if (lPaid < 0) lPaid = 0;

                                                return `
                                                <tr>
                                                    <td class="num-col">${this.currency(lAmount)}</td>
                                                    <td class="date-col">${this.format_date(loan.posting_date)}</td>
                                                    <td class="wrap-col">${this.product_cell(loan.loan_product)}</td>
                                                    <td class="date-col">${this.format_date(loan.repayment_start_date)}</td>
                                                    <td class="num-col">${loan.repayment_periods || "-"}</td>
                                                    <td class="num-col">${loan.monthly_repayment_amount ? this.currency(loan.monthly_repayment_amount) : "-"}</td>
                                                    <td class="num-col amount-paid">${this.currency(lPaid)}</td>
                                                    <td class="num-col amount-remaining">${this.currency(lRemaining)}</td>
                                                    <td>${this.status_label(loan.status)}</td>
                                                </tr>
                                                `;
                                            }).join("")}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                        </div>
                    </div>

                    <div class="employee-annual-row">
                        ${bottomSectionHtml}
                    </div>
                </div>
            `);

            if (hasAnnualLoan) {
                setTimeout(() => {
                    this.render_payment_chart_fixed(totalAnnualPaid, totalAnnualRemaining, empIdSafe);
                }, 200);
            }
        });
    }

    render_payment_chart_fixed(paid, remaining, empIdSafe) {
        let element = "#payment-" + empIdSafe;
        if (!$(element).length) return;

        let valuesArray = [paid, remaining];
        if (paid === 0 && remaining === 0) {
            valuesArray = [0, 1];
        }

        $(element).empty();

        new frappe.Chart(element, {
            type: "donut",
            height: 140,
            data: {
                labels: ["المدفوع", "المتبقي"],
                datasets: [{
                    values: valuesArray
                }]
            },
            // «المتبقي» كان #f1f5f9 -- أبيض تقريباً، فيختفي تماماً على الورق
            // ولا يكاد يُرى على الشاشة. رمادي واضح يُظهر القوس فعلاً.
            colors: ['#10b981', '#cbd5e1'],
            donutRadius: 45,
            tooltipOptions: {
                formatTooltipY: d => this.currency(d)
            }
        });
    }
}