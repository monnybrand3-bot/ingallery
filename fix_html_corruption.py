import re

with open('subscription_storage_plans/code.html', 'r') as f:
    content = f.read()

# Find all lines that look like //subscription_checkout/code.html... and replace them with correct <a> tags.
plans = ['Starter', 'Professional', 'Studio', 'Agency']
for plan in plans:
    # Match lines that start with //subscription_checkout/code.html?plan=PLAN"
    pattern = rf'//subscription_checkout/code.html\?plan={plan}".*?Choose {plan}</a>'
    replacement = f'<a href="/subscription_checkout/code.html?plan={plan}" class="block w-full text-center bg-secondary text-on-secondary py-3 rounded-lg font-label-md font-bold hover:opacity-90 transition-opacity">Choose {plan}</a>'
    content = re.sub(pattern, replacement, content, flags=re.DOTALL)

with open('subscription_storage_plans/code.html', 'w') as f:
    f.write(content)
