import re

with open('subscription_storage_plans/code.html', 'r') as f:
    content = f.read()

plans = ['Starter', 'Professional', 'Studio', 'Agency']
for plan in plans:
    pattern = rf'<button class="w-full bg-secondary text-on-secondary py-3 rounded-lg font-label-md font-bold hover:opacity-90 transition-opacity">\s*Choose {plan}\s*</button>'
    replacement = rf'<a href="subscription_checkout/code.html?plan={plan}" class="block w-full text-center bg-secondary text-on-secondary py-3 rounded-lg font-label-md font-bold hover:opacity-90 transition-opacity">\s*Choose {plan}\s*</a>'
    # We need to be careful with the \s* in replacement.
    # Let's just use a simple replacement.
    
    # Find all matches
    matches = re.finditer(pattern, content, re.DOTALL)
    
    # Since we are modifying the content, we should work backwards or use re.sub
    
content = re.sub(
    r'<button class="w-full bg-secondary text-on-secondary py-3 rounded-lg font-label-md font-bold hover:opacity-90 transition-opacity">\s*(Choose (Starter|Professional|Studio|Agency))\s*</button>',
    r'<a href="subscription_checkout/code.html?plan=\2" class="block w-full text-center bg-secondary text-on-secondary py-3 rounded-lg font-label-md font-bold hover:opacity-90 transition-opacity">\1</a>',
    content,
    flags=re.DOTALL
)

with open('subscription_storage_plans/code.html', 'w') as f:
    f.write(content)
