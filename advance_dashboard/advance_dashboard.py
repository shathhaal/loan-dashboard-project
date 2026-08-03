import frappe
import json
from frappe.utils import getdate, nowdate


def _parse_filters(filters, kwargs):
    raw_filters = filters or kwargs.get("filters") or {}
    if isinstance(raw_filters, str):
        try:
            return json.loads(raw_filters)
        except Exception:
            return {}
    return raw_filters


def _build_db_filters(filters, include_dates=True):
    # docstatus 1 only. Without this, cancelled loans and their amended
    # replacements are both returned -- e.g. AFPPF-2026-00772 (cancelled) and
    # AFPPF-2026-00772-1 (its amendment) both appeared, which is the duplicate
    # row seen in the employee tables. Drafts are excluded for the same reason.
    db_filters = {"docstatus": 1}

    if include_dates and filters.get("from_date") and filters.get("to_date"):
        db_filters["posting_date"] = [
            "between",
            [getdate(filters["from_date"]), getdate(filters["to_date"])]
        ]

    if filters.get("employee"):
        db_filters["applicant"] = filters["employee"]

    if filters.get("loan_product"):
        db_filters["loan_product"] = filters["loan_product"]

    return db_filters


def _get_loan_fields():
    """Only request fields that actually exist on this site's Loan doctype."""
    available_fields = [f.fieldname for f in frappe.get_meta("Loan").fields]
    fields_to_get = [
        "name", "applicant", "applicant_name", "posting_date", "status",
        "loan_product", "loan_amount", "total_amount_paid",
    ]
    for opt_field in [
        "repayment_periods", "monthly_repayment_amount",
        "repayment_start_date", "custom_loan_reason",
    ]:
        if opt_field in available_fields:
            fields_to_get.append(opt_field)
    return fields_to_get


def get_overdue_map(loan_names, cutoff_date):
    """Map loan -> overdue figures.

    Definition: a loan is overdue when it was issued BEFORE the selected start
    date, is not Completed (status != Closed), and has not been repaid in full.
    The overdue amount is the whole outstanding balance, because the entire
    loan predates the period under review.

    Schedule figures (instalments due, first due date) are joined only for
    display. The LATEST submitted schedule per loan is used: restructured
    loans carry several submitted schedules and joining them all double-counts
    principal (observed at ~2x loan value on this dataset).
    """
    if not loan_names or not cutoff_date:
        return {}

    rows = frappe.db.sql(
        """
        SELECT
            l.name AS loan,
            l.loan_amount,
            l.total_amount_paid,
            COUNT(rs.name) AS installments_total,
            SUM(CASE WHEN rs.payment_date < %(cutoff)s THEN 1 ELSE 0 END) AS installments_due,
            MIN(rs.payment_date) AS first_due_date
        FROM `tabLoan` l
        LEFT JOIN `tabLoan Repayment Schedule` lrs ON lrs.name = (
            SELECT x.name FROM `tabLoan Repayment Schedule` x
            WHERE x.loan = l.name AND x.docstatus = 1
            ORDER BY x.creation DESC LIMIT 1
        )
        LEFT JOIN `tabRepayment Schedule` rs ON rs.parent = lrs.name
        WHERE l.name IN %(loans)s
          AND l.status != 'Closed'
          AND l.posting_date < %(cutoff)s
        GROUP BY l.name, l.loan_amount, l.total_amount_paid
        """,
        {"loans": tuple(loan_names), "cutoff": getdate(cutoff_date)},
        as_dict=True,
    )

    overdue = {}
    for r in rows:
        amount = float(r.loan_amount or 0)
        paid = float(r.total_amount_paid or 0)
        outstanding = amount - paid
        if outstanding <= 0:
            continue

        overdue[r.loan] = {
            "overdue_amount": round(outstanding, 2),
            "installments_due": int(r.installments_due or 0),
            "installments_total": int(r.installments_total or 0),
            "first_due_date": str(r.first_due_date) if r.first_due_date else None,
        }
    return overdue


def get_employee_details(employee_names):
    """Department + base salary per employee.

    Employee has no base-salary field; it lives on the latest effective
    Salary Structure Assignment.
    """
    if not employee_names:
        return {}

    details = {}
    for emp in frappe.get_all(
        "Employee",
        filters={"name": ["in", list(employee_names)]},
        fields=["name", "employee_name", "department", "designation"],
    ):
        details[emp.name] = {
            "department": emp.department or "-",
            "designation": emp.designation or "-",
            "base_salary": 0,
        }

    salary_rows = frappe.db.sql(
        """
        SELECT ssa.employee, ssa.base
        FROM `tabSalary Structure Assignment` ssa
        WHERE ssa.docstatus = 1
          AND ssa.employee IN %(employees)s
          AND ssa.from_date <= %(today)s
          AND ssa.from_date = (
              SELECT MAX(y.from_date) FROM `tabSalary Structure Assignment` y
              WHERE y.employee = ssa.employee AND y.docstatus = 1
                AND y.from_date <= %(today)s
          )
        """,
        {"employees": tuple(employee_names), "today": nowdate()},
        as_dict=True,
    )
    for row in salary_rows:
        if row.employee in details:
            details[row.employee]["base_salary"] = float(row.base or 0)

    return details


def _get_overdue_cutoff(filters):
    """The selected start date. Instalments due before it can be overdue.

    For a MONTHLY view the cutoff snaps to 1 Jan of that year, so only loans
    from PAST YEARS count as overdue -- earlier months of the SAME year are
    NOT treated as arrears when a single month is selected. The yearly view
    (and quarter/half) keep their own from_date.
    """
    from_date = filters.get("from_date") or nowdate()
    if filters.get("period") == "month":
        year = getdate(from_date).year
        return getdate("{}-01-01".format(year))
    return from_date


def _get_overdue_scope_loans(filters):
    """Loan names eligible for the overdue check.

    Employee / product filters apply. The period range does NOT: an overdue
    loan predates the selected period by definition, so filtering by
    posting_date inside that period would exclude exactly what we want.
    The `posting_date < cutoff` restriction is applied in get_overdue_map.
    """
    scope_filters = _build_db_filters(filters, include_dates=False)
    scope_filters["status"] = ["!=", "Closed"]
    return [l.name for l in frappe.get_all("Loan", filters=scope_filters, fields=["name"])]


@frappe.whitelist()
def get_dashboard_data(filters=None, **kwargs):
    filters = _parse_filters(filters, kwargs)
    db_filters = _build_db_filters(filters)

    loans = frappe.get_all("Loan", filters=db_filters, fields=_get_loan_fields())

    total_loan = sum(l.loan_amount or 0 for l in loans)
    total_paid = sum(l.total_amount_paid or 0 for l in loans)
    remaining = total_loan - total_paid
    count = len(loans)
    average = total_loan / count if count else 0
    repayment_rate = round((total_paid / total_loan) * 100, 2) if total_loan else 0

    approved = sum(1 for l in loans if l.status in ["Approved", "Sanctioned"])
    pending = sum(1 for l in loans if l.status in ["Pending", "Draft", "Applied", "Requested"])
    rejected = sum(1 for l in loans if l.status == "Rejected")

    # Overdue = loans issued BEFORE the selected start date that are still not
    # repaid in full. Loans issued inside the period are current, not overdue.
    cutoff = _get_overdue_cutoff(filters)
    overdue_map = get_overdue_map(_get_overdue_scope_loans(filters), cutoff)
    overdue_count = len(overdue_map)
    overdue_amount = sum(o["overdue_amount"] for o in overdue_map.values())

    # Per-loan overdue figures for the loans actually on screen.
    period_overdue_map = {k: v for k, v in overdue_map.items() if k in {l.name for l in loans}}

    employees = frappe.get_all("Employee", fields=["name", "employee_name"])
    products = frappe.get_all("Loan Product", fields=["name"])

    return {
        "total_loan": total_loan,
        "total_paid": total_paid,
        "remaining": remaining,
        "average_loan": average,
        "loan_count": count,
        "approved": approved,
        "pending": pending,
        "rejected": rejected,
        "repayment_rate": repayment_rate,
        "overdue_count": overdue_count,
        "overdue_amount": round(overdue_amount, 2),
        "overdue_chart": prepare_overdue_aging_chart(overdue_map, cutoff),
        "overdue_cutoff": str(cutoff),
        "monthly_chart": prepare_month_chart(loans),
        "status_chart": prepare_status_chart(loans),
        "loan_type_chart": prepare_product_chart(loans),
        "employees_list": prepare_employee_data(loans, period_overdue_map, filters.get("from_date"), filters.get("to_date")),
        "filters": {
            "employees": employees,
            "loan_products": [p.name for p in products]
        }
    }


@frappe.whitelist()
def get_overdue_loan_details(filters=None, **kwargs):
    """Row-level overdue records for the drill-down table."""
    filters = _parse_filters(filters, kwargs)

    # Same scope as the summary card: ignores the period filter so arrears
    # from earlier years are listed too.
    cutoff = _get_overdue_cutoff(filters)
    scope_filters = _build_db_filters(filters, include_dates=False)
    scope_filters["status"] = ["!=", "Closed"]
    loans = frappe.get_all("Loan", filters=scope_filters, fields=_get_loan_fields())

    overdue_map = get_overdue_map([l.name for l in loans], cutoff)
    if not overdue_map:
        return []

    emp_details = get_employee_details({l.applicant for l in loans if l.applicant})

    rows = []
    for loan in loans:
        od = overdue_map.get(loan.name)
        if not od:
            continue

        emp = emp_details.get(loan.applicant, {})
        loan_amount = float(loan.loan_amount or 0)
        paid_amount = float(loan.total_amount_paid or 0)

        rows.append({
            "loan": loan.name,
            "employee": loan.applicant,
            "employee_name": loan.applicant_name or loan.applicant,
            "department": emp.get("department", "-"),
            "base_salary": emp.get("base_salary", 0),
            "loan_product": loan.loan_product or "-",
            "reason": getattr(loan, "custom_loan_reason", None) or "-",
            "posting_date": str(loan.posting_date) if loan.posting_date else "-",
            "repayment_start_date": str(getattr(loan, "repayment_start_date", "") or "-"),
            "loan_amount": loan_amount,
            "paid_amount": paid_amount,
            "remaining": loan_amount - paid_amount,
            "overdue_amount": od["overdue_amount"],
            "installments_due": od["installments_due"],
            "first_due_date": od["first_due_date"] or "-",
            "monthly_repayment_amount": float(getattr(loan, "monthly_repayment_amount", 0) or 0),
            "repayment_periods": int(getattr(loan, "repayment_periods", 0) or 0),
        })

    rows.sort(key=lambda r: r["overdue_amount"], reverse=True)
    return rows


def _month_key(d):
    return "%04d-%02d" % (d.year, d.month)


def _month_range(start, end):
    """Every year-month between the two dates, inclusive, as YYYY-MM keys."""
    keys = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        keys.append("%04d-%02d" % (y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return keys


def prepare_month_chart(loans):
    """Buckets loans by calendar month, keeping the year in the bucket key.

    One bucket per month, from its first day to its last -- so a month is always
    exactly one pair of bars no matter how many issue dates it contains. Daily
    bucketing was tried before and rejected: loans are issued in batches, and a
    month holding three batches drew three pairs of bars under a single month
    label, which read as six bars for one month.

    The year is part of the key. An earlier version bucketed by month number
    alone (1-12), so a range covering two years merged January 2025 into
    January 2026 and the axis could not show a year at all.

    Months with no loans stay in the range as empty buckets, so a quiet month
    reads as a visible gap rather than silently disappearing. Labels are ISO
    keys ("2026-01"); the JS formats them for display.
    """
    dated = [(getdate(loan.posting_date), loan) for loan in loans if loan.posting_date]

    if not dated:
        return {
            "labels": [],
            "granularity": "month",
            "loan_amounts": [],
            "paid_amounts": [],
            "counts": [],
            "applicant_counts": [],
        }

    dates = sorted({d for d, _ in dated})
    keys = _month_range(dates[0], dates[-1])

    index = {key: i for i, key in enumerate(keys)}
    loan_amounts = [0.0] * len(keys)
    paid_amounts = [0.0] * len(keys)
    counts = [0] * len(keys)
    applicants = [set() for _ in keys]

    for d, loan in dated:
        i = index.get(_month_key(d))
        if i is None:
            continue
        loan_amounts[i] += float(loan.loan_amount or 0)
        paid_amounts[i] += float(loan.total_amount_paid or 0)
        counts[i] += 1
        if loan.applicant:
            applicants[i].add(loan.applicant)

    return {
        "labels": keys,
        "granularity": "month",
        "loan_amounts": [round(a, 2) for a in loan_amounts],
        "paid_amounts": [round(a, 2) for a in paid_amounts],
        "counts": counts,
        "applicant_counts": [len(s) for s in applicants],
    }


def prepare_overdue_aging_chart(overdue_map, cutoff_date):
    """Bucket overdue balances by how long the oldest instalment was overdue
    as at the cutoff date (the selected start date)."""
    buckets = [
        ("أقل من 30 يوم", 0, 30),
        ("30 - 90 يوم", 30, 90),
        ("90 - 180 يوم", 90, 180),
        ("أكثر من 180 يوم", 180, None),
    ]
    amounts = [0.0] * len(buckets)
    counts = [0] * len(buckets)
    today = getdate(cutoff_date)

    for entry in overdue_map.values():
        # Every overdue loan must land in a bucket, otherwise the chart total
        # disagrees with the headline count. Loans with no schedule, or whose
        # first instalment falls after the cutoff, are treated as age 0.
        age_days = 0
        if entry.get("first_due_date"):
            age_days = max(0, (today - getdate(entry["first_due_date"])).days)

        for i, (_label, low, high) in enumerate(buckets):
            if age_days >= low and (high is None or age_days < high):
                amounts[i] += entry["overdue_amount"]
                counts[i] += 1
                break

    return {
        "labels": [b[0] for b in buckets],
        "amounts": [round(a, 2) for a in amounts],
        "counts": counts,
    }


def prepare_status_chart(loans):
    data = {}
    for loan in loans:
        status = loan.status or "غير محدد"
        if status not in data: data[status] = {"count": 0, "amount": 0}
        data[status]["count"] += 1
        data[status]["amount"] += float(loan.loan_amount or 0)
    return build_chart_data(data)


def prepare_product_chart(loans):
    data = {}
    for loan in loans:
        product = loan.loan_product or "غير محدد"
        if product not in data: data[product] = {"count": 0, "amount": 0}
        data[product]["count"] += 1
        data[product]["amount"] += float(loan.loan_amount or 0)
    return build_chart_data(data)


def build_chart_data(data):
    total = sum(x["amount"] for x in data.values())
    labels, values, details = [], [], []
    for key, value in data.items():
        labels.append(key)
        values.append(value["count"])
        percent = (value["amount"] / total * 100) if total else 0
        details.append({"name": key, "count": value["count"], "amount": value["amount"], "percentage": round(percent, 2)})
    return {"labels": labels, "values": values, "details": details}


def prepare_employee_data(loans, overdue_map=None, from_date=None, to_date=None):
    overdue_map = overdue_map or {}
    emp_details = get_employee_details({l.applicant for l in loans if l.applicant})

    employees = {}
    for loan in loans:
        emp = loan.applicant
        if not emp: continue

        if emp not in employees:
            detail = emp_details.get(emp, {})
            employees[emp] = {
                "name": emp,
                "employee_name": loan.applicant_name or emp,
                "department": detail.get("department", "-"),
                "designation": detail.get("designation", "-"),
                "base_salary": detail.get("base_salary", 0),
                "total_loan": 0, "paid_amount": 0, "remaining": 0,
                "installments": 0, "installment_amount": 0,
                "active_installment_amount": 0,
                "overdue_amount": 0, "overdue_count": 0,
                "deduction_percentage": 0,
                "loans": []
            }

        loan_amount = float(loan.loan_amount or 0)
        paid_amount = float(loan.total_amount_paid or 0)
        remaining_amount = loan_amount - paid_amount

        periods = int(getattr(loan, "repayment_periods", 0) or 0)
        monthly = float(getattr(loan, "monthly_repayment_amount", 0) or 0)
        # Derive whichever side is missing rather than guessing a period count.
        if not monthly and periods:
            monthly = loan_amount / periods
        elif monthly and not periods:
            periods = int(round(loan_amount / monthly)) if monthly else 0

        employees[emp]["total_loan"] += loan_amount
        employees[emp]["paid_amount"] += paid_amount
        employees[emp]["remaining"] += remaining_amount
        employees[emp]["installments"] += periods
        employees[emp]["installment_amount"] += monthly
        if loan.status not in ("Closed", "Rejected"):
            employees[emp]["active_installment_amount"] += monthly

        od = overdue_map.get(loan.name)
        if od:
            employees[emp]["overdue_amount"] += od["overdue_amount"]
            employees[emp]["overdue_count"] += 1

        employees[emp]["loans"].append({
            "loan": loan.name,
            "status": loan.status or "-",
            "loan_amount": loan_amount,
            "paid_amount": paid_amount,
            "posting_date": str(loan.posting_date) if loan.posting_date else "-",
            "loan_product": loan.loan_product or "-",
            "reason": getattr(loan, "custom_loan_reason", None) or "-",
            "repayment_start_date": str(getattr(loan, "repayment_start_date", "") or "-"),
            "remaining": remaining_amount,
            "repayment_periods": periods,
            "monthly_repayment_amount": monthly,
            "overdue_amount": od["overdue_amount"] if od else 0,
        })

    # Monthly deduction as a share of base salary. Only loans still being
    # repaid count -- including settled loans pushes this over 100%.
    for emp in employees.values():
        if emp["base_salary"]:
            emp["deduction_percentage"] = round(
                (emp["active_installment_amount"] / emp["base_salary"]) * 100, 1
            )

    # ===== Deduction for the selected period (PER-MONTH breakdown) =====
    # The 55% cap is a MONTHLY ceiling, so the deduction is inherently a
    # per-month figure. For any selected period we scan EVERY calendar month
    # inside [from_date, to_date] and record, per month, the sum of the
    # instalments deducted that month -- giving "كم أخذ كل شهر من النسبة".
    # `months` carries the whole timeline; `peak_month` + `by_type`/`loans`
    # are the heaviest single month (the headline vs 55%). A single-month view
    # yields one month; a yearly view yields the 12-month timeline.
    #
    # A loan is deducted in month k when its repayment window covers k: it runs
    # `repayment_periods` months starting at repayment_start_date (falling back
    # to posting_date). Months are integer indices (year*12 + month-1) so past
    # loans still being repaid inside the period count. COMPLETED (Closed) loans
    # are INCLUDED -- the manager wants each month's real historical deduction,
    # even for loans since paid off (only Rejected/never-disbursed are dropped).
    # The scheduled window is used (no per-instalment payment dates), so a loan
    # repaid early still shows across its full scheduled months.
    emp_names = list(employees.keys())
    active_by_emp = {}
    if emp_names:
        p_from = getdate(from_date) if from_date else getdate(nowdate())
        p_to = getdate(to_date) if to_date else getdate(nowdate())
        from_idx = p_from.year * 12 + (p_from.month - 1)
        to_idx = p_to.year * 12 + (p_to.month - 1)
        if to_idx < from_idx:
            to_idx = from_idx

        active_rows = frappe.get_all(
            "Loan",
            filters={
                "docstatus": 1,
                "status": ["!=", "Rejected"],
                "applicant": ["in", emp_names],
            },
            fields=["applicant", "loan_product", "monthly_repayment_amount",
                    "loan_amount", "repayment_periods", "posting_date",
                    "repayment_start_date"],
            order_by="posting_date asc",
        )

        # Per-loan monthly instalment + active month window [start_idx, end_idx].
        loans_by_emp = {}
        for r in active_rows:
            monthly = float(r.monthly_repayment_amount or 0)
            periods = int(r.repayment_periods or 0)
            if not monthly and periods:
                monthly = float(r.loan_amount or 0) / periods
            elif monthly and not periods:
                periods = int(round(float(r.loan_amount or 0) / monthly)) if monthly else 0
            if monthly <= 0:
                continue
            start = r.repayment_start_date or r.posting_date
            if not start:
                continue
            start = getdate(start)
            n = periods if periods > 0 else 1
            start_idx = start.year * 12 + (start.month - 1)
            loans_by_emp.setdefault(r.applicant, []).append({
                "loan_product": r.loan_product or "-",
                "monthly": monthly,
                "loan_amount": float(r.loan_amount or 0),
                "posting_date": str(r.posting_date) if r.posting_date else "-",
                "repayment_start_date": str(r.repayment_start_date) if r.repayment_start_date else "-",
                "start_idx": start_idx,
                "end_idx": start_idx + n - 1,
            })

        def _mkey(idx):
            return "{:04d}-{:02d}".format(idx // 12, (idx % 12) + 1)

        for emp_name, emp_loans in loans_by_emp.items():
            months = []       # full timeline: one entry per calendar month
            best = None       # (total, month_idx, active_loans) heaviest month
            for k in range(from_idx, to_idx + 1):
                active = [ln for ln in emp_loans if ln["start_idx"] <= k <= ln["end_idx"]]
                total = sum(ln["monthly"] for ln in active)
                by_type_k = {}
                for ln in active:
                    by_type_k[ln["loan_product"]] = by_type_k.get(ln["loan_product"], 0.0) + ln["monthly"]
                months.append({"month": _mkey(k), "total": total, "by_type": by_type_k})
                if total > 0 and (best is None or total > best[0]):
                    best = (total, k, active)
            if best is None:
                continue  # no deduction anywhere in the period
            total, k, active = best
            by_type = {}
            loans_out = []
            for ln in active:
                prod = ln["loan_product"]
                by_type[prod] = by_type.get(prod, 0.0) + ln["monthly"]
                loans_out.append({
                    "loan_product": prod,
                    "monthly": ln["monthly"],
                    "loan_amount": ln["loan_amount"],
                    "posting_date": ln["posting_date"],
                    "repayment_start_date": ln["repayment_start_date"],
                })
            active_by_emp[emp_name] = {
                "total_monthly": total,
                "by_type": by_type,
                "loans": loans_out,
                "peak_month": _mkey(k),
                "months": months,
            }

    empty_ded = {"total_monthly": 0.0, "by_type": {}, "loans": [], "peak_month": None, "months": []}
    for emp_name, emp in employees.items():
        emp["active_deduction"] = active_by_emp.get(emp_name, dict(empty_ded))

    return list(employees.values())
