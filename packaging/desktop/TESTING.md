# Desktop extension release test

Run this check with the exact `.mcpb` artifact that will be released.
Use a Mac that has never had OpenRater installed, or remove the prior
extension and its local data first. The purpose is to test the same first
experience a directory reviewer will see.

## Release gate

Before the hands-on test, the `desktop-build` workflow must be green on
macOS Apple Silicon, macOS Intel, and Windows. Both macOS jobs must say
`notarization: Accepted` in the signing step; a green unsigned build does
not satisfy this gate.

## Clean-Mac walk

1. Download the macOS artifact that matches the test Mac and extract the
   `.mcpb` file.
2. Install the `.mcpb` in Claude Desktop and enable OpenRater when prompted.
   There must be no unidentified-developer or malware warning.
3. Start a fresh chat and say exactly:

   > I have a rating manual PDF — can you build it into a rating plan?

4. Follow only the instructions OpenRater provides. When it offers the
   bundled Meridian sample, use that sample instead of supplying a private
   filing.
5. When OpenRater asks you to review the generated workbook, open it. Confirm
   that it is clearly labeled OpenRater, explains why review is required,
   and contains no legacy branding. Continue only after that review stop.
6. Complete the build and open the plan link. The plan must appear without
   manual setup, and the build report must show the sample test cases as
   verified.
7. Quote the sample risk. Its total premium must be **$1,898**, with a
   readable step-by-step trace.
8. Quit Claude Desktop, reopen it, and call `runtime_status` again. The
   extension must return healthy and the plan must still be present.

## Record the result

Keep only a short release note with:

- extension version and artifact name;
- Mac model and macOS version;
- pass/fail for install, first boot, workbook review, build, quote, and
  restart persistence;
- the workflow run URL that proves both notarizations were accepted.

Do not attach a real filing, workbook, or book of business to a public issue.
Use the bundled synthetic Meridian artifacts for bug reports.
