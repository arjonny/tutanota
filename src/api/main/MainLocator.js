//@flow
import type {WorkerClient} from "./WorkerClient"
import {EventController} from "./EventController"
import {EntropyCollector} from "./EntropyCollector"
import {SearchModel} from "../../search/SearchModel"
import type {CalendarUpdateDistributor} from "../../calendar/CalendarUpdateDistributor"
import type {MailboxDetail} from "../../mail/MailModel"
import {MailModel} from "../../mail/MailModel"
import type {CalendarInfo} from "../../calendar/CalendarView"
import type {CalendarEvent} from "../entities/tutanota/CalendarEvent"
import type {CalendarEventViewModel} from "../../calendar/CalendarEventViewModel"
import type {API} from "./Entity"
import {ClientsideAPI} from "./Entity"
import {assertMainOrNode} from "../Env"
import {Notifications} from "../../gui/Notifications"
import {logins} from "./LoginController"
import type {CalendarModel} from "../../calendar/CalendarModel"
import {asyncImport} from "../common/utils/Utils"

assertMainOrNode()

export type MainLocatorType = {
	eventController: EventController;
	entropyCollector: EntropyCollector;
	search: SearchModel;
	calendarUpdateDistributor: () => Promise<CalendarUpdateDistributor>;
	// Async because we have dependency cycles all over the place. It's also a good idea to not import it right away.
	calendarEventViewModel: (
		date: Date,
		calendars: Map<Id, CalendarInfo>,
		mailboxDetail: MailboxDetail,
		existingEvent?: CalendarEvent,
	) => Promise<CalendarEventViewModel>;
	mailModel: MailModel;
	api: API;

	init: (WorkerClient) => void;
}

export const locator: MainLocatorType = ({
	init(worker: WorkerClient) {
		const importBase = typeof module !== "undefined" ? module.id : __moduleName
		this.eventController = new EventController(logins)
		this.entropyCollector = new EntropyCollector(worker)
		this.search = new SearchModel()
		this.mailModel = new MailModel(new Notifications(), this.eventController)
		this.api = new ClientsideAPI()

		this.calendarUpdateDistributor = () =>
			asyncImport(importBase, `${env.rootPathPrefix}src/calendar/CalendarUpdateDistributor.js`)
				.then(({CalendarMailDistributor}) => new CalendarMailDistributor(this.mailModel))

		this.calendarEventViewModel = (date, calendars, mailboxDetail, existingEvent) =>
			Promise.all([
				this.calendarUpdateDistributor(),
				(asyncImport(importBase, `${env.rootPathPrefix}src/calendar/CalendarEventViewModel.js`):
					Promise<{CalendarEventViewModel: Class<CalendarEventViewModel>}>),
				(asyncImport(importBase, `${env.rootPathPrefix}src/calendar/CalendarModel.js`):
					Promise<{calendarModel: CalendarModel}>),
			]).then(([distributor, {CalendarEventViewModel}, {calendarModel}]) =>
				new CalendarEventViewModel(
					logins.getUserController(),
					distributor,
					calendarModel,
					mailboxDetail,
					date,
					calendars,
					existingEvent,
				)
			)
	}
}: any)

if (typeof window !== "undefined") {
	window.tutao.locator = locator
}