import { Router } from "express";
import { companyService } from "./company.service.js";
import {
  companyId,
  companyInput,
  companyQuery,
  companyUpdate,
} from "./company.schema.js";
export const companyRouter = Router();
companyRouter.get("/", async (req, res) => {
  res.json(await companyService.list(companyQuery.parse(req.query)));
});
companyRouter.get("/:id", async (req, res) => {
  res.json({ data: await companyService.get(companyId.parse(req.params.id)) });
});
companyRouter.post("/", async (req, res) => {
  const data = await companyService.create(companyInput.parse(req.body));
  res.location(`/api/v1/companies/${data.id}`).status(201).json({ data });
});
companyRouter.patch("/:id", async (req, res) => {
  res.json({
    data: await companyService.update(
      companyId.parse(req.params.id),
      companyUpdate.parse(req.body),
    ),
  });
});
