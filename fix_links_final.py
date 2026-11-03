import re

with open('subscription_storage_plans/code.html', 'r') as f:
    content = f.read()

# Correct the malformed links.
# We want to change any href that currently looks like 'href="//subscription_checkout/code.html'
# or 'href="../subscription_checkout/code.html' to 'href="/subscription_checkout/code.html'
pattern = r'href="[^"]*subscription_checkout/code.html'
replacement = 'href="/subscription_checkout/code.html'

# This regex is a bit crude. Let's use a more precise one.
# We find the start of the href and the start of 'subscription_checkout' and replace everything in between with '/'
def replace_href(match):
    full_match = match.group(0)
    # Find where 'subscription_checkout' starts and replace everything before it (including the quote) with href="/
    start_idx = full_match.find('subscription_checkout')
    return 'href="/' + full_match[start_idx:]

# Match from href=" to the start of subscription_checkout
content = re.sub(r'href="[^"]*?subscription_checkout', replace_href, content)

with open('subscription_storage_plans/code.html', 'w') as f:
    f.write(content)
