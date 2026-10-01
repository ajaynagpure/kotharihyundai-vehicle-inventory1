"use strict";
/* =====================================================================
   FIELDS: one master list = Excel heading  <->  database column
   Source files:  SaleDealerOrderStatus.xlsx (Order)  +  VehicleDeliveryStatusReport.xlsx (Purchase)
   [db column, Excel heading, type (text|date|money|num), extra header aliases]
   ===================================================================== */
const EXCEL_FIELDS = [
  // ---- Order report
  ["order_date","Order Date","date"],
  ["order_no","Order No","text",["order number","orderno","order id"]],
  ["pis_no","PIS No","text"],
  ["model","Model","text",["model name"]],
  ["variant","Variant","text",["variant name"]],
  ["color","Color","text",["colour"]],
  ["order_amount","Order Amount","money"],
  ["order_type","Order Type","text"],
  ["assigned_date","Assigned Date","date"],
  ["confirm_date","Confirm date","date"],
  ["vin","VIN No.","text",["vin","vin number","chassis no","chassis number","chassis"]],
  ["order_status","Order Status","text"],
  ["customer_id","Customer ID","text"],
  ["customer_name","Customer Name","text"],
  // ---- Purchase (Vehicle Delivery Status) report
  ["main_dealer","Main Dealer","text"],
  ["dealer_code","Dealer","text",["dealer code"]],
  ["hmi_invoice_date","HMI Invoice Date","date",["purchase date","invoice date"]],
  ["hmi_invoice_no","HMI Invoice No","text"],
  ["excise_invoice_no","Excise Invoice No","text"],
  ["fsc","FSC","text"],
  ["variant_code","Variant Code","text"],
  ["engine_no","Engine No","text",["engine number"]],
  ["finance_company","Financier Name","text",["finance company","finance name","finance","financier","bank"]],
  ["departure_date","Departure Date","date"],
  ["lot_number","Lot Number","text"],
  ["transporter_name","Transporter Name","text"],
  ["transporter_vehicle_no","Transporter Vehicle No.","text"],
  ["basic_price","Basic Price","money"],
  ["freight_insurance","Freight + Insurance","money"],
  ["total_invoice_value","Total Invoice value","money"],
  ["igst_pct","IGST %","num"],
  ["igst","IGST","money"],
  ["cgst_pct","CGST %","num"],
  ["cgst","CGST","money"],
  ["sgst_pct","SGST %","num"],
  ["sgst","SGST","money"],
  ["comp_cess_pct","Comp Cess %","num"],
  ["comp_cess","Comp Cess","money"],
  ["tcs_pct","TCS %","num"],
  ["tcs_value","TCS Value","money"],
  ["hmi_invoice_amount","HMI Invoice Amount","money"],
  ["hsn_code","HSN Code","text"],
  ["emission_type","Emission Type","text"],
  ["quantity","Quantity","num"],
  ["grn_no","GRN No","text"],
  ["grn_date","GRN Date","date"],
  ["sale_tax","Sale Tax","money"],
  ["fob_key","FOB Key","text"],
  // ---- Sales report (Tally Invoice Date, Vin No, Engine No, Customer Name, Tally Invoice No, Tally Location, Model, Variant, Color, Total Invoice value)
  //      Only Tally Invoice Date, VIN, Customer Name, Tally Invoice No, Tally Location are imported; the rest is taken from the Purchase report.
  ["bill_date","Tally Invoice Date","date",["bill inv date","bill date","bill invoice date"]],
  ["bill_no","Tally Invoice No","text",["tally invoice no.","tally invoice number","bill no","bill number"]],
  ["team_leader","TL","text",["team leader"]],
  ["executive","SC","text",["sales consultant","sales executive"]],
  ["sales_location","Tally Location","text",["bill location"]],
  ["bill_amount","Total Bill Amount","money",["bill amount"]]
];
// Not in the Excel files but kept on the vehicle record
const DERIVED_FIELDS = [["delivery_no","Delivery No","text"],["delivery_date","Delivery Date","date"],["delivery_location","Delivery Location","text"],["chassis_no","Chassis No","text"],["stock_value","Stock Value","money"],["purchase_date","Purchase Date","date"],["status","Status","text"]];
const FIELD_HEADING = Object.fromEntries([...EXCEL_FIELDS, ...DERIVED_FIELDS].map(f => [f[0], f[1]]));
const FIELD_TYPE = Object.fromEntries([...EXCEL_FIELDS, ...DERIVED_FIELDS].map(f => [f[0], f[2]]));

// Order report and Purchase report spell some models differently. Purchase (HMI invoice) names are kept,
// so reports never split one model into two rows. Add more pairs here if needed: "order-report name in lower case": "Purchase-report name".
const MODEL_ALIASES = {"creta":"New Creta","venue":"New Venue","i20":"All New i20","all new verna":"New Verna","ioniq 5":"Ioniq 5"};
