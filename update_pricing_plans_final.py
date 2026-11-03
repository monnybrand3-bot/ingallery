import sys

with open('subscription_storage_plans/code.html', 'r') as f:
    lines = f.readlines()

# 1. Define the new plan data based on the provided requirements
plans = [
    {
        "name": "Starter",
        "price": "TSh 15,000",
        "storage": "20 GB",
        "galleries": "10",
        "photos": "1,000",
        "features": [
            "Client downloads",
            "Original-quality downloads",
            "Client payment/unlock",
            "QR gallery links",
            "Gallery expiration",
            "Basic InGallery branding",
            "Client favorites/selection",
            "Gallery password",
            "Basic email notifications",
            "Basic analytics",
            "Bulk upload"
        ],
        "not_included": ["Custom branding", "Custom domain", "Priority support", "Team management", "Agency dashboard"],
        "watermark": "Basic",
        "users": "1",
        "support": "Standard"
    },
    {
        "name": "Professional",
        "price": "TSh 35,000",
        "storage": "100 GB",
        "galleries": "50",
        "photos": "3,000",
        "features": [
            "Client downloads",
            "Original-quality downloads",
            "Client payment/unlock",
            "QR gallery links",
            "Gallery expiration",
            "Optional InGallery branding",
            "Custom branding",
            "Client favorites/selection",
            "Gallery password",
            "Email notifications",
            "Basic analytics",
            "Bulk upload"
        ],
        "not_included": ["Custom domain", "Priority support", "Team management", "Agency dashboard"],
        "watermark": "Advanced",
        "users": "1",
        "support": "Standard"
    },
    {
        "name": "Studio",
        "price": "TSh 75,000",
        "storage": "500 GB",
        "galleries": "200",
        "photos": "10,000",
        "features": [
            "Client downloads",
            "Original-quality downloads",
            "Client payment/unlock",
            "QR gallery links",
            "Gallery expiration",
            "Remove InGallery branding",
            "Custom branding",
            "Custom domain",
            "Client favorites/selection",
            "Gallery password",
            "Email notifications",
            "Advanced analytics",
            "Bulk upload",
            "Priority support",
            "Team management"
        ],
        "not_included": ["Agency dashboard"],
        "watermark": "Advanced",
        "users": "3",
        "support": "Priority"
    },
    {
        "name": "Agency",
        "price": "TSh 120,000",
        "storage": "1 TB",
        "galleries": "Unlimited",
        "photos": "20,000",
        "features": [
            "Client downloads",
            "Original-quality downloads",
            "Client payment/unlock",
            "QR gallery links",
            "Gallery expiration",
            "Remove InGallery branding",
            "Custom branding",
            "Custom domain",
            "Client favorites/selection",
            "Gallery password",
            "Email notifications",
            "Advanced analytics",
            "Bulk upload",
            "Priority support",
            "Team management",
            "Agency dashboard"
        ],
        "not_included": [],
        "watermark": "Advanced",
        "users": "10",
        "support": "Priority"
    }
]

# Find the grid container
grid_start = -1
grid_end = -1
for i in range(len(lines)):
    if 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8' in lines[i]:
        grid_start = i
        brace_count = 0
        for j in range(i, len(lines)):
            brace_count += lines[j].count('<div')
            brace_count -= lines[j].count('</div>')
            if brace_count == 0:
                grid_end = j + 1
                break
        break

if grid_start != -1 and grid_end != -1:
    new_cards = []
    for plan in plans:
        # Generate feature list with checkmarks
        all_possible_features = [
            "Client downloads", "Original-quality downloads", "Client payment/unlock",
            "QR gallery links", "Gallery expiration", "InGallery branding",
            "Custom branding", "Custom domain", "Client favorites/selection",
            "Gallery password", "Email notifications", "Analytics",
            "Bulk upload", "Priority support", "Team management", "Agency dashboard"
        ]
        
        features_html = ""
        for feat in all_possible_features:
            # Check if feature is included (simplified check)
            is_included = any(feat.lower() in f.lower() for f in plan["features"])
            # Handle special branding cases
            if feat == "InGallery branding":
                if "Remove" in plan["features"] or "Optional" in plan["features"]:
                    status = "✓"
                else:
                    status = "✓" # Starter has basic
            else:
                status = "✓" if is_included else "—"
            
            features_html += f'<li class="flex items-center gap-2 text-sm text-on-surface-variant">{status} {feat}</li>\n'

        card = f'''
        <div class="glass-card rounded-2xl p-8 flex flex-col relative overflow-hidden group transition-all duration-300 hover:border-secondary/40 hover:bg-white/[0.05]">
            <div class="flex justify-between items-start mb-6">
                <div class="flex flex-col">
                    <h3 class="text-headline-sm font-headline-sm text-on-surface mb-1">{plan["name"]}</h3>
                    <p class="text-label-sm text-on-surface-variant uppercase tracking-widest">Monthly Plan</p>
                </div>
                <div class="text-right">
                    <span class="text-headline-md font-headline-md text-secondary">{plan["price"]}</span>
                </div>
            </div>
            <div class="flex flex-col gap-4 mb-8">
                <div class="flex items-center justify-between text-sm">
                    <span class="text-on-surface-variant">Storage</span>
                    <span class="text-on-surface font-medium">{plan["storage"]}</span>
                </div>
                <div class="flex items-center justify-between text-sm">
                    <span class="text-on-surface-variant">Active galleries</span>
                    <span class="text-on-surface font-medium">{plan["galleries"]}</span>
                </div>
                <div class="flex items-center justify-between text-sm">
                    <span class="text-on-surface-variant">Photos per gallery</span>
                    <span class="text-on-surface font-medium">{plan["photos"]}</span>
                </div>
            </div>
            <div class="mb-8">
                <p class="text-label-sm font-label-sm text-outline uppercase tracking-wider mb-3">Features</p>
                <ul class="flex flex-col gap-2">
                    {features_html}
                </ul>
            </div>
            <div class="mt-auto pt-6 border-t border-white/10">
                <div class="flex justify-between text-sm mb-4">
                    <span class="text-on-surface-variant">Team members</span>
                    <span class="text-on-surface font-medium">{plan["users"]}</span>
                </div>
                <div class="flex justify-between text-sm mb-4">
                    <span class="text-on-surface-variant">Watermarks</span>
                    <span class="text-on-surface font-medium">{plan["watermark"]}</span>
                </div>
                <div class="flex justify-between text-sm mb-6">
                    <span class="text-on-surface-variant">Support</span>
                    <span class="text-on-surface font-medium">{plan["support"]}</span>
                </div>
                <button class="w-full bg-secondary text-on-secondary py-3 rounded-lg font-label-md font-bold hover:opacity-90 transition-opacity">
                    Choose {plan["name"]}
                </button>
            </div>
        </div>
        '''
        new_cards.append(card)

    replacement = [
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">\n'
    ] + new_cards + ['</div>\n']
    
    lines[grid_start : grid_end] = replacement

with open('subscription_storage_plans/code.html', 'w') as f:
    f.writelines(lines)
