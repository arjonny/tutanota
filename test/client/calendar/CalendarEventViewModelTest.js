//@flow
import o from "ospec/ospec.js"
import {CalendarEventViewModel} from "../../../src/calendar/CalendarEventViewModel"
import {downcast, neverNull} from "../../../src/api/common/utils/Utils"
import {LazyLoaded} from "../../../src/api/common/utils/LazyLoaded"
import type {MailboxDetail} from "../../../src/mail/MailModel"
import type {CalendarEvent} from "../../../src/api/entities/tutanota/CalendarEvent"
import {createCalendarEvent} from "../../../src/api/entities/tutanota/CalendarEvent"
import {createGroupInfo} from "../../../src/api/entities/sys/GroupInfo"
import type {ShareCapabilityEnum} from "../../../src/api/common/TutanotaConstants"
import {GroupType, ShareCapability, TimeFormat} from "../../../src/api/common/TutanotaConstants"
import type {CalendarInfo} from "../../../src/calendar/CalendarView"
import {createGroupMembership} from "../../../src/api/entities/sys/GroupMembership"
import type {User} from "../../../src/api/entities/sys/User"
import {createUser} from "../../../src/api/entities/sys/User"
import {createCalendarEventAttendee} from "../../../src/api/entities/tutanota/CalendarEventAttendee"
import {createMailBox} from "../../../src/api/entities/tutanota/MailBox"
import {createGroup} from "../../../src/api/entities/sys/Group"
import {createMailboxGroupRoot} from "../../../src/api/entities/tutanota/MailboxGroupRoot"
import type {CalendarUpdateDistributor} from "../../../src/calendar/CalendarUpdateDistributor"
import type {IUserController} from "../../../src/api/main/UserController"
import {createEncryptedMailAddress} from "../../../src/api/entities/tutanota/EncryptedMailAddress"
import {CalendarModel} from "../../../src/calendar/CalendarModel"

const calendarGroupId = "0"
const now = new Date(2020, 4, 25, 13, 40)
const mailAddress = "address@tutanota.com"
const userId = "12356"

o.spec("CalendarEventViewModel", function () {

	o("init with existing event", function () {
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			description: "note",
			location: "location",
			_ownerGroup: calendarGroupId,
		})
		const viewModel = init({calendars: makeCalendars("own"), existingEvent})

		o(viewModel.summary()).equals(existingEvent.summary)
		o(viewModel.startDate.toISOString()).equals(new Date(2020, 4, 26).toISOString())
		o(viewModel.endDate.toISOString()).equals(new Date(2020, 4, 26).toISOString())
		o(viewModel.startTime).equals("12:00")
		o(viewModel.endTime).equals("13:00")
		o(viewModel.note()).equals(existingEvent.description)
		o(viewModel.location()).equals(existingEvent.location)
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(true)("canModifyGuests")
		o(viewModel.canModifyOwnAttendance()).equals(true)
		o(viewModel.canModifyOrganizer()).equals(true)
	})

	o("invite in our own calendar", function () {
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: "another-user@provider.com",
			_ownerGroup: calendarGroupId,
			isCopy: true,
			attendees: [createCalendarEventAttendee()]
		})
		const viewModel = init({calendars: makeCalendars("own"), existingEvent})
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(true)
		o(viewModel.canModifyOrganizer()).equals(false)
	})

	o("new invite (without calendar)", function () {
		const calendars = makeCalendars("own")
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: "another-user@provider.com",
			_ownerGroup: null,
			isCopy: true,
		})
		const viewModel = init({calendars, existingEvent})
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(true)
		o(viewModel.canModifyOrganizer()).equals(false)
	})

	o("in writable calendar", function () {
		const calendars = makeCalendars("shared")
		const userController = makeUserController()
		addCapability(userController.user, calendarGroupId, ShareCapability.Write)
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: "another-user@provider.com",
			_ownerGroup: calendarGroupId,
		})
		const viewModel = init({calendars, existingEvent, userController})
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(false)
		o(viewModel.canModifyOrganizer()).equals(false)
	})

	o("invite in writable calendar", function () {
		const calendars = makeCalendars("shared")
		const userController = makeUserController()
		addCapability(userController.user, calendarGroupId, ShareCapability.Write)
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: "another-user@provider.com",
			_ownerGroup: calendarGroupId,
			isCopy: true,
		})
		const viewModel = init({calendars, existingEvent, userController})
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(false)
		o(viewModel.canModifyOrganizer()).equals(false)
	})

	o("in readonly calendar", function () {
		const calendars = makeCalendars("shared")
		const userController = makeUserController()
		addCapability(userController.user, calendarGroupId, ShareCapability.Read)
		const existingEvent = createCalendarEvent({
			_ownerGroup: calendarGroupId,
		})
		const viewModel = init({calendars, existingEvent, userController})

		o(viewModel.readOnly).equals(true)
		o(viewModel.canModifyGuests()).equals(false)("canModifyGuests")
		o(viewModel.canModifyOwnAttendance()).equals(false)
		o(viewModel.canModifyOrganizer()).equals(false)
	})

	o("in writable calendar w/ guests", function () {
		const calendars = makeCalendars("shared")
		const userController = makeUserController()
		addCapability(userController.user, calendarGroupId, ShareCapability.Write)
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: "another-user@provider.com",
			_ownerGroup: calendarGroupId,
			attendees: [createCalendarEventAttendee()]
		})
		const viewModel = init({calendars, userController, existingEvent})
		o(viewModel.readOnly).equals(true)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(false)
		o(viewModel.canModifyOrganizer()).equals(false)
	})

	o.spec("delete event", function () {
		o("own event with attendees in own calendar", async function () {
			const calendars = makeCalendars("own")
			const distributor = makeDistributor()
			const attendee = makeAttendee()
			const calendarModel = makeCalendarModel()
			const existingEvent = createCalendarEvent({
				_id: ["listid", "calendarid"],
				_ownerGroup: calendarGroupId,
				organizer: mailAddress,
				attendees: [attendee]
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			await viewModel.deleteEvent()
			o(calendarModel.deleteEvent.calls.map(c => c.args)).deepEquals([[existingEvent]])
			o(distributor.sendCancellation.calls.map(c => c.args)).deepEquals([[existingEvent, [attendee.address]]])
		})

		o("own event without attendees in own calendar", async function () {
			const calendars = makeCalendars("own")
			const distributor = makeDistributor()
			const calendarModel = makeCalendarModel()
			const existingEvent = createCalendarEvent({
				_id: ["listid", "calendarid"],
				_ownerGroup: calendarGroupId,
				organizer: mailAddress,
				attendees: []
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			await viewModel.deleteEvent()
			o(calendarModel.deleteEvent.calls.map(c => c.args)).deepEquals([[existingEvent]])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("invite in own calendar", async function () {
			const calendars = makeCalendars("own")
			const distributor = makeDistributor()
			const calendarModel = makeCalendarModel()
			const attendee = makeAttendee()
			const existingEvent = createCalendarEvent({
				_id: ["listid", "calendarid"],
				_ownerGroup: calendarGroupId,
				organizer: "another-address@example.com",
				attendees: [attendee],
				isCopy: true,
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			await viewModel.deleteEvent()
			o(calendarModel.deleteEvent.calls.map(c => c.args)).deepEquals([[existingEvent]])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("in shared calendar", async function () {
			const calendars = makeCalendars("shared")
			const userController = makeUserController()
			addCapability(userController.user, calendarGroupId, ShareCapability.Write)
			const distributor = makeDistributor()
			const calendarModel = makeCalendarModel()
			const attendee = makeAttendee()
			const existingEvent = createCalendarEvent({
				_id: ["listid", "calendarid"],
				_ownerGroup: calendarGroupId,
				organizer: mailAddress,
				attendees: [attendee],
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			await viewModel.deleteEvent()
			o(calendarModel.deleteEvent.calls.map(c => c.args)).deepEquals([[existingEvent]])
			o(distributor.sendCancellation.calls).deepEquals([])
		})
	})

	o.spec("create event", function () {
		o("own calendar, no guests", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const viewModel = init({calendars, existingEvent: null, calendarModel, distributor})
			const summary = "Summary"
			viewModel.summary(summary)

			o(await viewModel.onOkPressed()).deepEquals({status: "ok", askForUpdates: null})

			const [createdEvent] = calendarModel.createEvent.calls[0].args
			o(createdEvent.summary).equals("Summary")
			o(distributor.sendInvite.calls).deepEquals([])
		})

		o("own calendar, new guests", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const viewModel = init({calendars, existingEvent: null, calendarModel, distributor})
			const newGuest = "new-attendee@example.com"
			viewModel.addAttendee(newGuest)

			o(await viewModel.onOkPressed()).deepEquals({status: "ok", askForUpdates: null})
			o(calendarModel.createEvent.calls.length).equals(1)("created event")
			o(distributor.sendInvite.calls[0].args[2]).deepEquals([createEncryptedMailAddress({address: newGuest})])
		})

		o.only("own calendar, same guests, agree on updates", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const guest = "new-attendee@example.com"
			const existingEvent = createCalendarEvent({
				attendees: [
					createCalendarEventAttendee({
						address: createEncryptedMailAddress({address: guest})
					})
				],
				organizer: mailAddress,
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			viewModel.onStartDateSelected(new Date(2020, 4, 3))

			const result = await viewModel.onOkPressed()
			if (result.status !== "ok") {
				throw new Error("Result is not ok")
			}
			if (result.askForUpdates == null) {
				throw new Error("Did not ask for updates")
			}
			o(distributor.sendUpdate.calls).deepEquals([])

			await neverNull(result.askForUpdates)(true)
			o(calendarModel.createEvent.calls.length).equals(1)("created event")
			o(distributor.sendUpdate.calls[0].args[1]).deepEquals([createEncryptedMailAddress({address: guest})])
		})
	})
})

function init({userController, distributor, mailboxDetail, calendars, existingEvent, calendarModel}: {
	userController?: IUserController,
	distributor?: CalendarUpdateDistributor,
	mailboxDetail?: MailboxDetail,
	calendars: Map<Id, CalendarInfo>,
	calendarModel?: CalendarModel,
	existingEvent: ?CalendarEvent,
}): CalendarEventViewModel {
	return new CalendarEventViewModel(
		userController || makeUserController(),
		distributor || makeDistributor(),
		calendarModel || makeCalendarModel(),
		mailboxDetail || makeMailboxDetail(),
		now,
		calendars,
		existingEvent
	)
}

function makeCalendars(type: "own" | "shared"): Map<string, CalendarInfo> {
	const calendarInfo = {
		groupRoot: downcast({}),
		longEvents: new LazyLoaded(() => Promise.resolve([])),
		groupInfo: downcast({}),
		group: createGroup({
			_id: calendarGroupId,
			type: GroupType.Calendar,
		}),
		shared: type === "shared"
	}
	return new Map([[calendarGroupId, calendarInfo]])
}

function makeUserController(): IUserController {
	return downcast({
		user: createUser({_id: userId}),
		props: {
			defaultSender: mailAddress,
		},
		userGroupInfo: createGroupInfo({
			mailAddressAliases: [],
			mailAddress: mailAddress,
		}),
		userSettingsGroupRoot: {
			timeFormat: TimeFormat.TWENTY_FOUR_HOURS,
		}
	})
}

function addCapability(user: User, groupId: Id, capability: ShareCapabilityEnum) {
	user.memberships.push(createGroupMembership({
		group: groupId,
		capability,
	}))
}

function makeAttendee() {
	return createCalendarEventAttendee({
		address: createEncryptedMailAddress({
			address: "attendee@example.com"
		})
	})
}

function makeMailboxDetail(): MailboxDetail {
	return {
		mailbox: createMailBox(),
		folders: [],
		mailGroupInfo: createGroupInfo(),
		mailGroup: createGroup({user: userId}),
		mailboxGroupRoot: createMailboxGroupRoot(),
	}
}

function makeDistributor(): CalendarUpdateDistributor {
	return {
		sendInvite: o.spy(() => Promise.resolve()),
		sendUpdate: o.spy(() => Promise.resolve()),
		sendCancellation: o.spy(() => Promise.resolve()),
		sendResponse: o.spy(() => Promise.resolve()),
	}
}

function makeCalendarModel(): CalendarModel {
	return {
		createEvent: o.spy(() => Promise.resolve()),
		updateEvent: o.spy(() => Promise.resolve()),
		deleteEvent: o.spy(() => Promise.resolve()),
	}
}