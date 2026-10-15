import { Router } from "express";
import { personService } from "./person.service.js";
import {
  personId,
  personInput,
  personQuery,
  personUpdate,
} from "./person.schema.js";

export const personRouter = Router();

personRouter.get("/", async (req, res) => {
  res.json(await personService.list(personQuery.parse(req.query)));
});
personRouter.get("/:id", async (req, res) => {
  res.json({ data: await personService.get(personId.parse(req.params.id)) });
});
personRouter.post("/", async (req, res) => {
  const data = await personService.create(personInput.parse(req.body));
  res.location(`/api/v1/people/${data.id}`).status(201).json({ data });
});
personRouter.patch("/:id", async (req, res) => {
  res.json({
    data: await personService.update(
      personId.parse(req.params.id),
      personUpdate.parse(req.body),
    ),
  });
});
personRouter.delete("/:id", async (req, res) => {
  await personService.remove(personId.parse(req.params.id));
  res.status(204).end();
});
