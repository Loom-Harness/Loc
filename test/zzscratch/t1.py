p = "test/macro/scaffold-body-builders.test.ts"
s = open(p).read()
R = [
    ('Anchor("Orders", to: "/orders"), Text("New"))', 'Anchor(plural(Order), to: "/orders"), Text("New"))'),
    ("'Breadcrumbs(Anchor(\"Home\", to: \"/\"), Text(\"Orders\"))'", "'Breadcrumbs(Anchor(\"Home\", to: \"/\"), Text(plural(Order)))'"),
    ("'Heading(\"Orders\", level: 2)'", "'Heading(plural(Order), level: 2)'"),
    ('Column("Reference", o => Text(o.reference)', 'Column(label(Order.reference), o => Text(o.reference)'),
    ('Column("Status", o => Text(o.status)', 'Column(label(Order.status), o => Text(o.status)'),
    ('Column("Ref", o => IdLink', 'Column(label(Order.ref), o => IdLink'),
    ('Column("Created At", o =>', 'Column(label(Order.createdAt), o =>'),
    ('Column("Active", o =>', 'Column(label(Order.active), o =>'),
    ('Column("Total", o =>', 'Column(label(Order.total), o =>'),
    ('Column("Status", o => EnumBadge', 'Column(label(Order.status), o => EnumBadge'),
    ('Column("Note", o =>', 'Column(label(Order.note), o =>'),
    ('Column("Blob", o =>', 'Column(label(Order.blob), o =>'),
    ("'Anchor(\"Categories\", to: \"/categories\")'", "'Anchor(plural(Category), to: \"/categories\")'"),
    ('Anchor("Workflows", to: "/workflows"), Text("Place Order"))', 'Anchor("Workflows", to: "/workflows"), Text(label(placeOrder)))'),
    ("'Heading(\"Place Order\", level: 2)'", "'Heading(label(placeOrder), level: 2)'"),
    ("'title: \"Approve\",'", "'title: label(Order.approve),'"),
    ("'trigger: Button(\"Approve\", emphasis", "'trigger: Button(label(Order.approve), emphasis"),
    ("'KeyValueRow(\"Name\"'", "'KeyValueRow(label(Widget.name)'"),
    ("'KeyValueRow(\"Deleted At\"'", "'KeyValueRow(label(Widget.deletedAt)'"),
    ("'KeyValueRow(\"Title\"'", "'KeyValueRow(label(Task.title)'"),
    ("'KeyValueRow(\"Version\"'", "'KeyValueRow(label(Release.version)'"),
    ('Anchor("Orders", to: "/orders"), Text("Detail"))', 'Anchor(plural(Order), to: "/orders"), Text("Detail"))'),
    ('KeyValueRow("Reference", Text(data.reference)', 'KeyValueRow(label(Order.reference), Text(data.reference)'),
    ("'Heading(\"Lines\", level: 4)'", "'Heading(label(Order.lines), level: 4)'"),
    ("'Column(\"Sku\", row =>", "'Column(label(OrderLine.sku), row =>"),
    ("'Column(\"Quantity\", row =>", "'Column(label(OrderLine.quantity), row =>"),
    ("'Column(\"Order Id\", i =>", "'Column(label(Fulfillment.orderId), i =>"),
    ("'Column(\"Status\", i => EnumBadge", "'Column(label(Fulfillment.status), i => EnumBadge"),
    ("'KeyValueRow(\"Order Id\", IdLink", "'KeyValueRow(label(Fulfillment.orderId), IdLink"),
    ("'KeyValueRow(\"Status\", EnumBadge", "'KeyValueRow(label(Fulfillment.status), EnumBadge"),
    ("'Card(Heading(\"Issues\", level: 4)", "'Card(Heading(plural(Issue), level: 4)"),
    ("'Card(Heading(\"Projects\", level: 4)", "'Card(Heading(plural(Project), level: 4)"),
]
for a, b in R:
    n = s.count(a)
    if n == 0:
        print("MISSING", a)
    s = s.replace(a, b)
open(p, "w").write(s)
