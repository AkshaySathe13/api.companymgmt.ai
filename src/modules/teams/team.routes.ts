import { Router } from "express";
import { viewerOf } from "../auth/session.js";
import { teamService } from "./team.service.js";
import { personId } from "../people/person.schema.js";
import {
  memberInput,
  teamId,
  teamInput,
  teamQuery,
  teamUpdate,
} from "./team.schema.js";

// Mounted behind `authenticate`; the service applies the viewer's access rules.
export const teamRouter = Router();

teamRouter.get("/", async (req, res) => {
  res.json(await teamService.list(viewerOf(req), teamQuery.parse(req.query)));
});
teamRouter.get("/:id", async (req, res) => {
  res.json({
    data: await teamService.get(viewerOf(req), teamId.parse(req.params.id)),
  });
});
teamRouter.post("/", async (req, res) => {
  const input = teamInput.parse(req.body);
  const data = await teamService.create(viewerOf(req), input);
  res.location(`/api/v1/teams/${data.id}`).status(201).json({ data });
});
teamRouter.patch("/:id", async (req, res) => {
  const id = teamId.parse(req.params.id);
  const input = teamUpdate.parse(req.body);
  res.json({ data: await teamService.update(viewerOf(req), id, input) });
});
teamRouter.delete("/:id", async (req, res) => {
  await teamService.remove(viewerOf(req), teamId.parse(req.params.id));
  res.status(204).end();
});
teamRouter.post("/:id/members", async (req, res) => {
  const id = teamId.parse(req.params.id);
  const member = memberInput.parse(req.body).personId;
  res
    .status(201)
    .json({ data: await teamService.addMember(viewerOf(req), id, member) });
});
teamRouter.delete("/:id/members/:personId", async (req, res) => {
  const id = teamId.parse(req.params.id);
  const member = personId.parse(req.params.personId);
  res.json({ data: await teamService.removeMember(viewerOf(req), id, member) });
});
