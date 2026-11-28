import { test, expect } from "@playwright/test";

test("production build boots under a non-root base path", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      response.url().startsWith("http://127.0.0.1:4174/")
    ) {
      errors.push(response.url() + ": " + response.status());
    }
  });
  await page.goto(process.env.GLOBE_BASE_PATH ?? "/migration/");
  await expect(page).toHaveTitle("Quadstream Globe");
  await expect(
    page.getByRole("main", { name: "Quadstream Globe" }),
  ).toBeVisible();
  await expect(page.locator("#globe")).toBeVisible();
  await expect(page.locator("#status")).toHaveAttribute("data-phase", "ready", {
    timeout: 60000,
  });
  await expect
    .poll(() => page.locator("#globe").getAttribute("data-source-vertices"))
    .not.toBe("0");
  await page.waitForLoadState("load");
  expect(errors).toEqual([]);
});

test("GitHub source link stays accessible on desktop and mobile", async ({
  page,
  context,
}) => {
  const repository = "https://github.com/vizhub-studio/quadstream";
  await context.route(repository, (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>GitHub</title>" }),
  );
  await page.goto(process.env.GLOBE_BASE_PATH ?? "/migration/");
  const link = page.getByRole("link", { name: "View source on GitHub" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", repository);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await link.focus();
  await expect(link).toBeFocused();
  const popupPromise = page.waitForEvent("popup");
  await link.press("Enter");
  const popup = await popupPromise;
  await expect(popup).toHaveURL(repository);
  await popup.close();

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(link).toBeInViewport();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(link).toBeInViewport();
});
