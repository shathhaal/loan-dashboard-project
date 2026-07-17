import frappe
import json
from frappe.utils import getdate

@frappe.whitelist()
def get_dashboard_data(filters=None, **kwargs):
    raw_filters = filters or kwargs.get("filters") or {}

    if isinstance(raw_filters, str):
        try:
            filters = json.loads(raw_filters)
        except Exception:
            filters = {}
    else:
        filters = raw_filters

    db_filters = {}

    if filters.get("from_date") and filters.get("to_date"):
        db_filters["posting_date"] = [
            "between",
            [getdate(filters["from_date"]), getdate(filters["to_date"])]
        ]

    if filters.get("employee"):
        db_filters["applicant"] = filters["employee"]

    if filters.get("loan_product"):
        db_filters["loan_product"] = filters["loan_product"]

    # جلب الحقول المتوفرة فعلياً في قاعدة البيانات فقط     
    available_fields = [f.fieldname for f in frappe.get_meta("Loan").fields]
    fields_to_get = ["name", "applicant", "applicant_name", "posting_date", "status", "loan_product", "loan_amount", "total_amount_paid"]
    
    # التحقق من وجود الحقول الإضافية قبل طلبها
    for opt_field in ["repayment_periods", "monthly_repayment_amount", "repayment_start_date"]:
        if opt_field in available_fields:
            fields_to_get.append(opt_field)

    loans = frappe.get_all(
        "Loan",
        filters=db_filters,
        fields=fields_to_get
    )

    total_loan = sum(l.loan_amount or 0 for l in loans)
    total_paid = sum(l.total_amount_paid or 0 for l in loans)
    remaining = total_loan - total_paid
    count = len(loans)
    average = total_loan / count if count else 0
    repayment_rate = round((total_paid / total_loan) * 100, 2) if total_loan else 0

    approved = sum(1 for l in loans if l.status in ["Approved", "Sanctioned"])
    pending = sum(1 for l in loans if l.status in ["Pending", "Draft", "Applied", "Requested"])
    rejected = sum(1 for l in loans if l.status == "Rejected")

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
        "monthly_chart": prepare_month_chart(loans),
        "status_chart": prepare_status_chart(loans),
        "loan_type_chart": prepare_product_chart(loans),
        "employees_list": prepare_employee_data(loans),
        "filters": {
            "employees": employees,
            "loan_products": [p.name for p in products]
        }
    }

def prepare_month_chart(loans):
    labels = [str(i) for i in range(1, 13)]
    loan_amounts = [0] * 12
    paid_amounts = [0] * 12
    counts = [0] * 12
    for loan in loans:
        if loan.posting_date:
            m = getdate(loan.posting_date).month - 1
            if 0 <= m < 12:
                loan_amounts[m] += float(loan.loan_amount or 0)
                paid_amounts[m] += float(loan.total_amount_paid or 0)
                counts[m] += 1
    return {"labels": labels, "loan_amounts": loan_amounts, "paid_amounts": paid_amounts, "counts": counts}

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

def prepare_employee_data(loans):
    employees = {}
    for loan in loans:
        emp = loan.applicant
        if not emp: continue
        if emp not in employees:
            employees[emp] = {
                "name": emp,
                "employee_name": loan.applicant_name or emp,
                "total_loan": 0, "paid_amount": 0, "remaining": 0,
                "installments": 0, "installment_amount": 0, "loans": []
            }
        loan_amount = float(loan.loan_amount or 0)
        paid_amount = float(loan.total_amount_paid or 0)
        remaining_amount = loan_amount - paid_amount

        employees[emp]["total_loan"] += loan_amount
        employees[emp]["paid_amount"] += paid_amount
        employees[emp]["remaining"] += remaining_amount
        employees[emp]["installments"] += int(getattr(loan, "repayment_periods", 0) or 0)
        employees[emp]["installment_amount"] += float(getattr(loan, "monthly_repayment_amount", 0) or 0)

        employees[emp]["loans"].append({
            "loan_amount": loan_amount,
            "posting_date": str(loan.posting_date) if loan.posting_date else "-",
            "loan_product": loan.loan_product or "-",
            "reason": "-",
            "repayment_start_date": str(getattr(loan, "repayment_start_date", "-")),
            "remaining": remaining_amount
        })
    return list(employees.values())