//@flow
import o from "ospec/ospec.js"
import type {EventCreateResult} from "../../../src/calendar/CalendarEventViewModel"
import {CalendarEventViewModel} from "../../../src/calendar/CalendarEventViewModel"
import {downcast} from "../../../src/api/common/utils/Utils"
import {LazyLoaded} from "../../../src/api/common/utils/LazyLoaded"
import type {MailboxDetail} from "../../../src/mail/MailModel"
import type {CalendarEvent} from "../../../src/api/entities/tutanota/CalendarEvent"
import {createCalendarEvent} from "../../../src/api/entities/tutanota/CalendarEvent"
import {createGroupInfo} from "../../../src/api/entities/sys/GroupInfo"
import type {ShareCapabilityEnum} from "../../../src/api/common/TutanotaConstants"
import {CalendarAttendeeStatus, GroupType, ShareCapability, TimeFormat} from "../../../src/api/common/TutanotaConstants"
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
import {getAllDayDateUTCFromZone} from "../../../src/calendar/CalendarUtils"
import {DateTime} from "luxon"

const calendarGroupId = "0"
const now = new Date(2020, 4, 25, 13, 40)
const zone = "Europe/Berlin"
const mailAddress = "address@tutanota.com"
const userId = "12356"

o.spec("CalendarEventViewModel", function () {
	o("init with existing event", function () {
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: DateTime.fromObject({year: 2020, month: 5, day: 26, hour: 12, zone}).toJSDate(),
			endTime: DateTime.fromObject({year: 2020, month: 5, day: 26, hour: 13, zone}).toJSDate(),
			description: "note",
			location: "location",
			_ownerGroup: calendarGroupId,
			organizer: mailAddress,
			description: "descr"
		})
		const viewModel = init({calendars: makeCalendars("own"), existingEvent})

		o(viewModel.summary()).equals(existingEvent.summary)
		o(viewModel.startDate.toISOString()).equals(DateTime.fromObject({year: 2020, month: 5, day: 26}).toJSDate().toISOString())
		o(viewModel.endDate.toISOString()).equals(DateTime.fromObject({year: 2020, month: 5, day: 26}).toJSDate().toISOString())
		o(viewModel.startTime).equals("12:00")
		o(viewModel.endTime).equals("13:00")
		o(viewModel.note).equals(existingEvent.description)
		o(viewModel.location()).equals(existingEvent.location)
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(true)("canModifyGuests")
		o(viewModel.canModifyOwnAttendance()).equals(true)
		o(viewModel.canModifyOrganizer()).equals(true)
		o(viewModel.organizer).equals(mailAddress)
		o(viewModel.possibleOrganizers).deepEquals([mailAddress])
	})

	o("init all day event", function () {
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: getAllDayDateUTCFromZone(new Date(2020, 4, 26), zone),
			endTime: getAllDayDateUTCFromZone(new Date(2020, 4, 27), zone),
			description: "note",
			location: "location",
			_ownerGroup: calendarGroupId,
		})
		const viewModel = init({calendars: makeCalendars("own"), existingEvent})

		o(viewModel.summary()).equals(existingEvent.summary)
		o(viewModel.startDate.toISOString()).equals(DateTime.fromObject({year: 2020, month: 5, day: 26, zone}).toJSDate().toISOString())
		o(viewModel.endDate.toISOString()).equals(DateTime.fromObject({year: 2020, month: 5, day: 26, zone}).toJSDate().toISOString())
	})

	o("invite in our own calendar", function () {
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: "another-user@provider.com",
			_ownerGroup: calendarGroupId,
			isCopy: true,
			attendees: [
				createCalendarEventAttendee({
					address: createEncryptedMailAddress({address: "attendee@example.com"})
				}),
				createCalendarEventAttendee({
					address: createEncryptedMailAddress({address: mailAddress})
				})
			]
		})
		const viewModel = init({calendars: makeCalendars("own"), existingEvent})
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(true)
		o(viewModel.canModifyOrganizer()).equals(false)
		o(viewModel.possibleOrganizers).deepEquals([existingEvent.organizer])
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
			attendees: [
				createCalendarEventAttendee({
					address: createEncryptedMailAddress({address: mailAddress}),
					status: CalendarAttendeeStatus.ACCEPTED,
				})
			]
		})
		const viewModel = init({calendars, existingEvent})
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(true)
		o(viewModel.canModifyOrganizer()).equals(false)
		o(viewModel.possibleOrganizers).deepEquals([existingEvent.organizer])
		o(viewModel.going).equals(CalendarAttendeeStatus.ACCEPTED)
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
		o(viewModel.possibleOrganizers).deepEquals([existingEvent.organizer])
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
		o(viewModel.possibleOrganizers).deepEquals([existingEvent.organizer])
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
			attendees: [
				createCalendarEventAttendee({
					address: createEncryptedMailAddress({address: "attendee@example.com"})
				})
			]
		})
		const viewModel = init({calendars, userController, existingEvent})
		o(viewModel.readOnly).equals(true)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(false)
		o(viewModel.canModifyOrganizer()).equals(false)
		o(viewModel.possibleOrganizers).deepEquals([existingEvent.organizer])
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
			const newDescription = "new description"
			viewModel.changeDescription(newDescription)

			o(await viewModel.onOkPressed()).deepEquals({status: "ok", askForUpdates: null})

			const [createdEvent] = calendarModel.createEvent.calls[0].args
			o(createdEvent.summary).equals("Summary")
			o(createdEvent.description).equals(newDescription)
			o(distributor.sendInvite.calls).deepEquals([])
			o(distributor.sendCancellation.calls).deepEquals([])
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
			o(distributor.sendInvite.calls[0].args[1]).deepEquals([createEncryptedMailAddress({address: newGuest})])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("own calendar, same guests, agree on updates", async function () {
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
			const askForUpdates = assertAskedForUpdates(result)
			o(distributor.sendUpdate.calls).deepEquals([])
			await askForUpdates(true)
			o(calendarModel.createEvent.calls.length).equals(1)("created event")
			o(distributor.sendUpdate.calls[0].args[1]).deepEquals([createEncryptedMailAddress({address: guest})])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("own calendar, old, new, removed guests, agree on updates", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const oldGuest = "old-attendee@example.com"
			const newGuest = "new-attendee@example.com"
			const toRemoveGuest = "remove-attendee@example.com"
			const toRemoveAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: toRemoveGuest})
			})
			const existingEvent = createCalendarEvent({
				attendees: [
					createCalendarEventAttendee({
						address: createEncryptedMailAddress({address: oldGuest})
					}),
					toRemoveAttendee
				],
				organizer: mailAddress,
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			viewModel.onStartDateSelected(new Date(2020, 4, 3))
			viewModel.addAttendee(newGuest)
			viewModel.removeAttendee(toRemoveAttendee)

			const result = await viewModel.onOkPressed()
			const askForUpdates = assertAskedForUpdates(result)
			o(distributor.sendUpdate.calls).deepEquals([])
			await askForUpdates(true)

			o(calendarModel.createEvent.calls.length).equals(1)("created event")
			o(distributor.sendUpdate.calls[0].args[1]).deepEquals([createEncryptedMailAddress({address: oldGuest})])
			o(distributor.sendInvite.calls[0].args[1]).deepEquals([createEncryptedMailAddress({address: newGuest})])
			o(distributor.sendCancellation.calls[0].args[1]).deepEquals([toRemoveAttendee.address])
		})

		o("own calendar, old, new, removed guests, do not send updates", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const oldGuest = "old-attendee@example.com"
			const newGuest = "new-attendee@example.com"
			const toRemoveGuest = "remove-attendee@example.com"
			const toRemoveAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: toRemoveGuest})
			})
			const existingEvent = createCalendarEvent({
				attendees: [
					createCalendarEventAttendee({
						address: createEncryptedMailAddress({address: oldGuest})
					}),
					toRemoveAttendee
				],
				organizer: mailAddress,
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			viewModel.onStartDateSelected(new Date(2020, 4, 3))
			viewModel.addAttendee(newGuest)
			viewModel.removeAttendee(toRemoveAttendee)

			const result = await viewModel.onOkPressed()
			const askForUpdates = assertAskedForUpdates(result)
			o(distributor.sendUpdate.calls).deepEquals([])
			await askForUpdates(false)

			o(calendarModel.createEvent.calls.length).equals(1)("created event")
			o(distributor.sendUpdate.calls).deepEquals([])
			o(distributor.sendInvite.calls).deepEquals([])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("own calendar, only removed guests, send updates", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const toRemoveGuest = "remove-attendee@example.com"
			const toRemoveAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: toRemoveGuest})
			})
			const existingEvent = createCalendarEvent({
				attendees: [
					toRemoveAttendee
				],
				organizer: mailAddress,
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			viewModel.onStartDateSelected(new Date(2020, 4, 3))
			viewModel.removeAttendee(toRemoveAttendee)

			const result = await viewModel.onOkPressed()
			const askForUpdates = assertAskedForUpdates(result)
			o(distributor.sendUpdate.calls).deepEquals([])
			await askForUpdates(true)

			o(calendarModel.createEvent.calls.length).equals(1)("created event")
			o(distributor.sendCancellation.calls[0].args[1]).deepEquals([toRemoveAttendee.address])
		})

		o("send response", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const ownAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: mailAddress}),
				status: CalendarAttendeeStatus.NEEDS_ACTION,
			})
			const anotherAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: "another-attendee@example.com"}),
				status: CalendarAttendeeStatus.DECLINED,
			})
			const existingEvent = createCalendarEvent({
				startTime: new Date(2020, 5, 1),
				endTime: new Date(2020, 5, 2),
				organizer: "another-address@example.com",
				attendees: [ownAttendee, anotherAttendee],
				isCopy: true,
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			viewModel.selectGoing(CalendarAttendeeStatus.ACCEPTED)
			const result = await viewModel.onOkPressed()

			o(result).deepEquals({status: "ok", askForUpdates: null})
			const [createdEvent] = calendarModel.createEvent.calls[0].args
			o(createdEvent.attendees.length).equals(2)
			o(createdEvent.attendees.find(a => a.address === ownAttendee.address).status).equals(CalendarAttendeeStatus.ACCEPTED)
			o(createdEvent.attendees.find(a => a.address === anotherAttendee.address).status).equals(CalendarAttendeeStatus.DECLINED)
			o(distributor.sendUpdate.calls).deepEquals([])
			o(distributor.sendInvite.calls).deepEquals([])
			o(distributor.sendCancellation.calls).deepEquals([])
			const [_, sentSender, sentStatus] = distributor.sendResponse.calls[0].args
			o(sentSender.address).equals(mailAddress)
			o(sentStatus).equals(CalendarAttendeeStatus.ACCEPTED)
		})

		o("existing event times preserved", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const startTime = DateTime.fromObject({year: 2020, month: 6, day: 4, hour: 12, zone}).toJSDate()
			const endTime = DateTime.fromObject({year: 2020, month: 6, day: 4, hour: 13, zone}).toJSDate()
			const existingEvent = createCalendarEvent({startTime, endTime})
			const viewModel = init({calendars, existingEvent, calendarModel})
			const result = await viewModel.onOkPressed()
			o(result).deepEquals({status: "ok", askForUpdates: null})
			const [createdEvent] = calendarModel.createEvent.calls[0].args
			o(createdEvent.startTime.toISOString()).deepEquals(startTime.toISOString())
			o(createdEvent.endTime.toISOString()).deepEquals(endTime.toISOString())
		})
	})

	o.spec("onStartDateSelected", function () {
		o("date adjusted forward", async function () {
			const calendars = makeCalendars("own")
			const existingEvent = createCalendarEvent({
				startTime: DateTime.fromObject({year: 2020, month: 6, day: 8, hour: 13, zone}).toJSDate(),
				endTime: DateTime.fromObject({year: 2020, month: 6, day: 9, hour: 15, zone}).toJSDate(),
			})
			const viewModel = init({calendars, existingEvent})
			viewModel.onStartDateSelected(DateTime.fromObject({year: 2020, month: 6, day: 10, zone}).toJSDate())

			// No hours because it's a "date", not "time" field.
			o(viewModel.endDate.toISOString())
				.equals(DateTime.fromObject({year: 2020, month: 6, day: 11, zone}).toJSDate().toISOString())
			o(viewModel.endTime).equals("15:00")
		})

		o("date adjusted backwards", async function () {
			const calendars = makeCalendars("own")
			const existingEvent = createCalendarEvent({
				startTime: DateTime.fromObject({year: 2020, month: 6, day: 8, hour: 13, zone}).toJSDate(),
				endTime: DateTime.fromObject({year: 2020, month: 6, day: 9, hour: 15, zone}).toJSDate(),
			})
			const viewModel = init({calendars, existingEvent})
			viewModel.onStartDateSelected(DateTime.fromObject({year: 2020, month: 6, day: 6, zone}).toJSDate())

			// No hours because it's a "date", not "time" field.
			o(viewModel.endDate.toISOString())
				.equals(DateTime.fromObject({year: 2020, month: 6, day: 7, zone}).toJSDate().toISOString())
			o(viewModel.endTime).equals("15:00")
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
		zone,
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

function assertAskedForUpdates(result: EventCreateResult): ((bool) => Promise<void>) {
	if (result.status !== "ok") {
		throw new Error("Result is not ok")
	}
	if (result.askForUpdates == null) {
		throw new Error("Did not ask for updates")
	}
	return result.askForUpdates
}