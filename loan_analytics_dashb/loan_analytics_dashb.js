frappe.pages['loan_analytics_dashb'].on_page_load = function(wrapper) {
    let page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Loan Analytics Dashboard',
        single_column: true
    });
    
    page.add_inner_button(__('تصدير PDF'), () => {
        window.print();
    });

    $(wrapper).find(".layout-main-section").html(
        frappe.render_template("loan_analytics_dashb", {})
    );

    setTimeout(() => {
        window.loan_dashboard = new LoanAnalyticsDashboard();
    }, 150);
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
                let q = Math.floor(today.getMonth() / 3);
                from = new Date(year, q * 3, 1);
                to = new Date(year, (q * 3) + 3, 0);
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
    }

    load_data() {
        let me = this;
        frappe.call({
            method: "afppf_project_management.afppf_project_management.page.loan_analytics_dashb.loan_analytics_dashb.get_dashboard_data",
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
    }

    currency(value) {
        return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    render_charts() {
        this.render_month_chart();
        this.render_status_chart();
        this.render_product_chart();
    }
    

    render_month_chart() {
        let data = this.data.monthly_chart;
        const mainContainer = document.getElementById("monthly-loan-chart");
        
        if (!data || !mainContainer) return;

        const arabic_months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
        let labels = data.labels.map(l => {
            let mIdx = parseInt(l) - 1;
            return arabic_months[mIdx] || l;
        });
        

        // 💡 تحديث ثوري للتصميم: تفكيك الحاوية لإنشاء مكان مخصص ومنفصل للمنحنى لكي يظهر 100% بدون سحق بالملايين
        mainContainer.innerHTML = `
            <div id="frappe-bars-sub-chart" style="height: 240px; margin-bottom: 20px;"></div>
            <div style="border-top: 1px dashed #e2e8f0; margin: 15px 0;"></div>
            <div id="frappe-line-sub-chart" style="height: 140px;"></div>
        `;

        // 1. رسم الأعمدة للمبالغ (ملايين)
        this.charts.month_bars = new frappe.Chart("#frappe-bars-sub-chart", {
            title: "مبالغ السلف والمدفوعات الشهري",
            data: {
                labels: labels,
                datasets: [
                    { name: "مبلغ السلفة", chartType: "bar", values: data.loan_amounts || [] },
                    { name: "المبلغ المدفوع", chartType: "bar", values: data.paid_amounts || [] }
                ]
            },
            type: "bar", 
            height: 240,
            colors: ["#0891b2", "#2ea66f"],
            axisOptions: { shortenYAxisLongValues: true, xIsSeries: true }
        });

        // 2. رسم المنحنى لعدد الطلبات بشكل منفصل تماماً وبمقياس رسم متناسق وممتاز (1، 2، 3...)
        this.charts.month_line = new frappe.Chart("#frappe-line-sub-chart", {
            title: "منحنى عدد طلبات السلف المستلمة",
            data: {
                labels: labels,
                datasets: [
                    { name: "عدد الطلبات", chartType: "line", values: data.counts || [] }
                ]
            },
            type: "line", 
            height: 140,
            colors: ["#e67b35"],
            lineOptions: { regionFill: 1, dotSize: 6 },
            axisOptions: { xIsSeries: true }
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
                        background-color: #f1f5f9;
                        color: #334155;
                        font-weight: 700;
                        padding: 14px;
                        border-bottom: 2px solid #cbd5e1;
                        font-size: 0.9rem;
                    }
                    .custom-hover-table tbody td {
                        padding: 14px;
                        border-bottom: 1px solid #f1f5f9;
                        color: #475569;
                    }
                    .custom-hover-table tbody tr:hover td {
                        background-color: #fafbfc;
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
                    .bg-warning-subtle { background-color: #fef3c7 !important; color: #d97706 !important; }
                    .bg-success-subtle { background-color: #d1fae5 !important; color: #065f46 !important; }
                    
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

                    let lInstallments = parseInt(
                        loan.total_repayment_months || 
                        loan.total_number_of_payments || 
                        loan.repayment_periods || 
                        loan.no_of_installments || 0
                    );

                    let lMonthlyValue = parseFloat(
                        loan.repayment_amount || 
                        loan.monthly_installment_amount || 
                        loan.installment_amount || 0
                    );

                    if (lInstallments === 0 && lMonthlyValue > 0) {
                        lInstallments = Math.round(lAmount / lMonthlyValue);
                    } else if (lInstallments > 0 && lMonthlyValue === 0) {
                        lMonthlyValue = lAmount / lInstallments;
                    } else if (lInstallments === 0 && lMonthlyValue === 0) {
                        lInstallments = 3; 
                        lMonthlyValue = lAmount / lInstallments;
                    }

                    totalAnnualAmount += lAmount;
                    totalAnnualPaid += lPaid;
                    totalAnnualRemaining += lRemaining;
                    totalInstallmentsCount += lInstallments;
                    totalInstallmentValue += lMonthlyValue;

                    annualCardsHtml += `
                        <div class="annual-loan-block mb-4" style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; background: #ffffff;">
                            <div class="info-badge-container">
                                <div class="info-card-badge"><strong>تاريخ السلفة:</strong> ${loan.posting_date || "-"}</div>
                                <div class="info-card-badge"><strong>أساس التوزيع:</strong> أقساط شهرية منتظمة</div>
                                <div class="info-card-badge"><strong>تاريخ بداية الخصم:</strong> ${loan.repayment_start_date || "-"}</div>
                            </div>
                            
                            <div class="table-responsive">
                                <table class="table custom-hover-table" style="margin-bottom: 0;">
                                    <thead>
                                        <tr>
                                            <th>مبلغ السلفة</th>
                                            <th>المدفوع</th>
                                            <th>المتبقي</th>
                                            <th>عدد الأقساط</th>
                                            <th>قيمة القسط</th>
                                            <th>نسبة الخصم</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td class="fw-bold" style="color: #1e293b;">${this.currency(lAmount)}</td>
                                            <td class="text-success fw-bold">${this.currency(lPaid)}</td>
                                            <td class="text-danger fw-bold">${this.currency(lRemaining)}</td>
                                            <td>${lInstallments} قسط</td>
                                            <td style="color: #0891b2;" class="fw-bold">${this.currency(lMonthlyValue)}</td>
                                            <td>${emp.deduction_percentage || emp.percentage || 0}%</td>
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

            let statusText = "جاري السداد";
            let statusClass = "bg-warning-subtle text-warning";
            if (progressPercent >= 100 && totalAnnualAmount > 0) {
                statusText = "مكتمل";
                statusClass = "bg-success-subtle text-success";
            }

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
                                        <div class="col-md-2 col-4 text-success">مدفوع: <span style="display:block; color:#16a34a; font-size:1rem;">${this.currency(totalAnnualPaid)}</span></div>
                                        <div class="col-md-2 col-4 text-danger">متبقي: <span style="display:block; color:#dc2626; font-size:1rem;">${this.currency(totalAnnualRemaining)}</span></div>
                                        <div class="col-md-3 col-12 mt-2 mt-md-0 text-info">أقساط: <span style="display:block; color:#0891b2; font-size:1rem;">${totalInstallmentsCount} (${this.currency(totalInstallmentValue)}/ش)</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-4">
                            <div class="card-section text-center d-flex flex-column justify-content-center" style="height: 100%;">
                                <h6 class="fw-bold align-self-start mb-3" style="color: #334155;">تقدم السداد الإجمالي (السنوية)</h6>
                                
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <span style="font-size:1.6rem; font-weight:800; color:#0f172a;">${progressPercent}%</span>
                                    <small class="badge ${statusClass} fw-bold" style="padding: 6px 12px; border-radius: 20px; font-size:0.8rem;">${statusText}</small>
                                </div>

                                <div class="progress-bar-container mb-4">
                                    <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
                                </div>

                                <div class="chart-wrapper" style="position: relative; height: 140px; margin: 0 auto; width: 100%;">
                                    <div id="payment-${empIdSafe}" style="height: 140px;"></div>
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
                    <div class="row g-4">
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
                                    <p class="fw-bold text-success" style="font-size:1.05rem; margin-bottom:0;">${this.currency(emp.base_salary || 0)}</p>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-9">
                            <div class="card-section mb-4">
                                <h6 class="fw-bold mb-3" style="color: #334155; font-size:1.1rem;">تفاصيل السلف الحالية والسابقة</h6>
                                <div class="table-responsive" style="border-radius:12px; border:1px solid #e2e8f0; overflow:hidden;">
                                    <table class="table custom-hover-table" style="margin-bottom: 0;">
                                        <thead>
                                            <tr>
                                                <th>مبلغ السلفة</th>
                                                <th>التاريخ</th>
                                                <th>نوع السلفة</th>
                                                <th>السبب</th>
                                                <th>بداية الخصم</th>
                                                <th>المدفوع</th>
                                                <th>المتبقي</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${allLoans.map(loan => {
                                                let lAmount = parseFloat(loan.loan_amount || 0);
                                                let lRemaining = parseFloat(loan.remaining || 0);
                                                let lPaid = loan.paid_amount ? parseFloat(loan.paid_amount) : (lAmount - lRemaining);
                                                if (lPaid < 0) lPaid = 0;

                                                let cleanProduct = loan.loan_product || "-";
                                                if (cleanProduct.includes('-')) {
                                                    cleanProduct = cleanProduct.split('-')[1] || cleanProduct;
                                                }

                                                return `
                                                <tr>
                                                    <td class="fw-bold" style="color:#0f172a;">${this.currency(lAmount)}</td>
                                                    <td>${loan.posting_date || "-"}</td>
                                                    <td><span class="badge" style="background-color: #f0fdfa; color: #0d9488; padding: 6px 12px; border-radius: 20px; font-weight:600; border:1px solid #ccfbf1;">${cleanProduct}</span></td>
                                                    <td>${loan.reason || "-"}</td>
                                                    <td>${loan.repayment_start_date || "-"}</td>
                                                    <td class="text-success fw-bold">${this.currency(lPaid)}</td>
                                                    <td class="text-danger fw-bold">${this.currency(lRemaining)}</td>
                                                </tr>
                                                `;
                                            }).join("")}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            ${bottomSectionHtml}
                        </div>
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
            colors: ['#10b981', '#f1f5f9'],
            donutRadius: 45,
            tooltipOptions: {
                formatTooltipY: d => this.currency(d)
            }
        });
    }
}