Product Overview and Vision: The vision for Covrily is an app that automatically tracks and manages your receipts, tracks return window, catches price-adjustment opportunities, registers warranties, flags recalls, and drafts claims — so you get your money’s worth after you buy. this will be enable through scanning customer emails for receipts and collecting data from those receipts. MVP 1 will only be scanning emails. MVP 2 we will add the feature that enables users to scan paper receipts through uploaded pictures.

High level for how this comes together: Postmark is our email tool. Supabase will store the data captured from the emails. We need to get specific in our data extraction, enabling data be extracted from receipts that my send given various scenarios. For example, receipts sent to the body of the email, receipts sent through attachments (e.g., pdfs), receipts sent through separate links. Scanning email inboxes will need to be dynamic. We cannot hardcode individual vendors, we must find ways to identify receipts from inbox’s (maybe AI is a tool here, if there is a simpler way then also great).

Primary value metric: “Money/Value Recovered” per user (refunds, price adjustments, rebates) + “Losses Avoided” (returned on time, warranty claims approved).

Delivery: Final product must be accessible through the apple app store. 
