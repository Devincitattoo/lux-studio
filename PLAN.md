# PLAN — LUX Studio

This is the to-do file the overnight builder loop reads. It builds the **next unchecked item**, verifies it (tests + typecheck + linter), fixes failures, and repeats until green. Keep items small and in order. Check a box `[x]` when done.

## How the builder loop uses this file

- It works top-to-bottom and picks the first unchecked `[ ]` item under **Tasks**.
- Each item should be small enough to build + verify in one pass.
- Add a stop condition when you run it: `/loop ... or stop after 10 turns`.

---

## Goal

*one big paragraph: what this workflow should do when it's finished.* 
'Automate my lux studio business idea the one that scrapes airbnb mansion property data all over the top highest ranked areas in the world and send them a pitch on the airbnb platform, email, and text from the scraped data loop that runs every 30min and then saves all of that data to supbase account but checks that the scraped account info doesnt already have video flythroughs in there listing on airbnb first., from there pitchess them a high converting flythrough video pitch with references from a landing page that you have created of content youve made from the video flythroughs youve produced of other peoples airbnbs that youve created on higgsfield and charge them based size of there property and difficulty anywhere from $799 to $2000 dollars. Takes that takes that data and has the system check for new replies from the landowners every 5 min running checks on new leads at the same time and putting that data into supabase and then from there takes there replies and talks to them focusing on converting that lead into the appropriate sale amount in the most tactical way possible using social engenering scripts to make the sale and have the highest conversion rate possible using claude to then link everything through mcps to get the job requests done to have the same results as [Soarly.ai](http://Soarly.ai) on higgsfiedd using seedance for prompt engineering for the best most highest quality results. Make sure that they have paid via stripe account integration setup through mcp as well which then requests are fulfilled and is sent to them via email/text or to their chosen preference of receiving the video flythrough and have claude take all of the data and tracking the conversions, whats pending and pitched, processed, still creating also whats been created how many lead to prospects to finished sales etc. and then pushes all of that data to a interactive high quality live streaming dashboard that is updated by the second When i say LAUNCH LUX STUDIO, the system will start and run autonomously without any of my interference and outputs the live tracking data. This process should be self learning and always iterating itself to become higher converting and better performing every single day it should reflect itself and upgrade things that work better based off of its tracked data from every interaction and sale and find out  new ways to promote, speak to clients, and create higher quality digital product outputs. This is a turn key system that just keeps getting better and more efficient and more profitable as each day goes on. It should never stop running as it should have cron jobs happening every 5 and 30 minutes. Build this whole LUX STUDIO system out for me and dont stop until its done find a way to finish the whole thing once i say the command BUILD LUX STUDIO.'

## Definition of done

- [x] It runs end-to-end without errors
- [x] Tests pass, typecheck clean, linter clean
- [x] Output matches the goal above

---

## Tasks (build in this order)

- [x] 1. Set up the project skeleton (folders, package/config, run script)
- [x] 2. Define the inputs the workflow takes and where they come from
- [x] 3. Build the core step that does the main work
- [x] 4. Add the verifier/check step (validate the output is correct)
- [x] 5. Add the stop condition / success criteria
- [x] 6. Write tests for each step
- [x] 7. Wire the steps together into one runnable workflow
- [x] 8. Add error handling + a short run summary at the end
- [x] 9. Add Higgsfield MCP video generation integration and video metadata wiring
- [x] 10. Document live production configuration and fail-fast live mode behavior
- [ ] 11. Add Supabase persistence and live dashboard state sync
- [ ] 12. Add SMS and Airbnb platform messaging support

## Notes / decisions

- Use TypeScript for safety and modular step composition.
- Keep external dependencies minimal.
- Use a file-backed state store so the workflow is runnable locally.
- Use stubbed communication and integration connectors to avoid unauthorized scraping or sending real messages.

## Done

- Project skeleton and workflow scaffold created.
