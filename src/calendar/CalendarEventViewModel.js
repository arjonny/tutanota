//@flow
import type {CalendarInfo} from "./CalendarView"
import type {AlarmIntervalEnum, CalendarAttendeeStatusEnum, EndTypeEnum, RepeatPeriodEnum} from "../api/common/TutanotaConstants"
import {CalendarAttendeeStatus, EndType, RepeatPeriod, TimeFormat} from "../api/common/TutanotaConstants"
import type {CalendarEventAttendee} from "../api/entities/tutanota/CalendarEventAttendee"
import {createCalendarEventAttendee} from "../api/entities/tutanota/CalendarEventAttendee"
import type {CalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import {createCalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import type {AlarmInfo} from "../api/entities/sys/AlarmInfo"
import {createAlarmInfo} from "../api/entities/sys/AlarmInfo"
import type {MailboxDetail} from "../mail/MailModel"
import stream from "mithril/stream/stream.js"
import {getDefaultSenderFromUser} from "../mail/MailUtils"
import {
	assignEventId,
	createRepeatRuleWithValues,
	filterInt,
	generateUid,
	getAllDayDateForTimezone,
	getAllDayDateUTCFromZone,
	getEventEnd,
	getEventStart,
	getStartOfDayWithZone,
	getStartOfNextDayWithZone,
	getTimeZone,
	parseTime,
	timeString,
	timeStringFromParts
} from "./CalendarUtils"
import {clone, downcast, neverNull, noOp} from "../api/common/utils/Utils"
import {generateEventElementId, isAllDayEvent} from "../api/common/utils/CommonCalendarUtils"
import {incrementByRepeatPeriod} from "./CalendarModel"
import m from "mithril"
import {createEncryptedMailAddress} from "../api/entities/tutanota/EncryptedMailAddress"
import {remove} from "../api/common/utils/ArrayUtils"
import {erase, load} from "../api/main/Entity"
import {NotFoundError} from "../api/common/error/RestError"
import {worker} from "../api/main/WorkerClient"
import type {CalendarRepeatRule} from "../api/entities/tutanota/CalendarRepeatRule"
import {isSameId, listIdPart} from "../api/common/EntityFunctions"
import {UserAlarmInfoTypeRef} from "../api/entities/sys/UserAlarmInfo"
import type {User} from "../api/entities/sys/User"
import {incrementDate} from "../api/common/utils/DateUtils"

const TIMESTAMP_ZERO_YEAR = 1970

export class CalendarEventViewModel {
	+summary: Stream<string>;
	+calendars: Array<CalendarInfo>;
	+selectedCalendar: Stream<CalendarInfo>;
	startDate: Date;
	endDate: Date;
	startTime: string;
	endTime: string;
	+allDay: Stream<boolean>;
	repeat: ?{frequency: RepeatPeriodEnum, interval: number, endType: EndTypeEnum, endValue: number}
	+attendees: Array<CalendarEventAttendee>;
	organizer: ?string;
	+possibleOrganizers: $ReadOnlyArray<string>;
	+location: Stream<string>;
	+note: Stream<string>;
	+amPmFormat: bool;
	+existingEvent: ?CalendarEvent
	_oldStartTime: ?string;
	+readOnly: bool;
	+_zone: string;
	// We keep alarms read-only so that view can diff just array and not all elements
	alarms: $ReadOnlyArray<AlarmInfo>;
	going: CalendarAttendeeStatusEnum;
	_user: User;

	constructor(date: Date, calendars: Map<Id, CalendarInfo>, mailboxDetail: MailboxDetail, userController: IUserController,
	            existingEvent?: CalendarEvent) {
		this.summary = stream("")
		this.calendars = Array.from(calendars.values())
		this.selectedCalendar = stream(this.calendars[0])
		this.attendees = existingEvent && existingEvent.attendees.slice() || []
		this.organizer = existingEvent && existingEvent.organizer || getDefaultSenderFromUser(userController)
		// TODO
		this.possibleOrganizers = [this.organizer]
		this.location = stream("")
		this.note = stream("")
		this.allDay = stream(true)
		this.amPmFormat = userController.userSettingsGroupRoot.timeFormat === TimeFormat.TWELVE_HOURS
		this.existingEvent = existingEvent
		this._zone = getTimeZone()
		this.alarms = []
		this.readOnly = false // TODO
		this.going = CalendarAttendeeStatus.NEEDS_ACTION; // TODO
		this._user = userController.user

		/**
		 * Capability for events is fairly complicated:
		 * Not share "shared" means "not owner of the calendar". Calendar always looks like personal for the owner.
		 *
		 * | Calendar | Organizer | Can do |
		 * |----------|-----------|---------
		 * | Personal | Self      | everything
		 * | Personal | Other     | everything (local copy of shared event)
		 * | Shared   | Self      | everything
		 * | Shared   | Other     | cannot modify if there are guests
		 */

		// TODO: re-do this capability things, some of them should be dynamic
		// const user = logins.getUserController().user
		// let calendarArray = Array.from(calendars.values())
		// let readOnly = false
		// const mailAddresses = getEnabledMailAddresses(mailboxDetail)
		// const attendees = existingEvent && existingEvent.attendees.slice() || []
		// const organizer = stream(existingEvent && existingEvent.organizer || getDefaultSenderFromUser())
		// const isOwnEvent = mailAddresses.includes(organizer())
		// let canModifyGuests = isOwnEvent
		// let canModifyOwnAttendance = true
		//
		// if (!existingEvent) {
		// 	calendarArray = calendarArray.filter(calendarInfo => hasCapabilityOnGroup(user, calendarInfo.group, ShareCapability.Write))
		// } else {
		// 	// OwnerGroup is not set for invites
		// 	const calendarInfoForEvent = existingEvent._ownerGroup && calendars.get(existingEvent._ownerGroup)
		// 	if (calendarInfoForEvent) {
		// 		readOnly = !hasCapabilityOnGroup(logins.getUserController().user, calendarInfoForEvent.group, ShareCapability.Write)
		// 			|| calendarInfoForEvent.shared && attendees.length > 0
		// 		canModifyGuests = isOwnEvent && !calendarInfoForEvent.shared
		// 		canModifyOwnAttendance = !calendarInfoForEvent.shared
		// 	}
		// }

		if (existingEvent) {
			this.summary(existingEvent.summary)
			const calendarForGroup = calendars.get(neverNull(existingEvent._ownerGroup))
			if (calendarForGroup) {
				this.selectedCalendar(calendarForGroup)
			}
			this.allDay(isAllDayEvent(existingEvent))
			this.startDate = getStartOfDayWithZone(getEventEnd(existingEvent, this._zone), this._zone)
			if (this.allDay()) {
				this.startTime = timeString(getEventStart(existingEvent, this._zone), this.amPmFormat)
				this.endTime = timeString(getEventEnd(existingEvent, this._zone), this.amPmFormat)
				this.endDate = incrementDate(getEventEnd(existingEvent, this._zone), -1)
			} else {
				this.endDate = getStartOfDayWithZone(getEventEnd(existingEvent, this._zone), this._zone)
			}
			this.startTime = timeString(getEventStart(existingEvent, this._zone), this.amPmFormat)
			this.endTime = timeString(getEventEnd(existingEvent, this._zone), this.amPmFormat)
			if (existingEvent.repeatRule) {
				const existingRule = existingEvent.repeatRule
				const repeat = {
					frequency: downcast(existingRule.frequency),
					interval: Number(existingRule.interval),
					endType: downcast(existingRule.endType),
					endValue: existingRule.endType === EndType.Count ? Number(existingRule.endValue) : 1,
				}
				// TODO end type date
				if (existingRule.endType === EndType.UntilDate) {
					const rawEndDate = new Date(Number(existingRule.endValue))
					const localDate = this.allDay() ? getAllDayDateForTimezone(rawEndDate, this._zone) : rawEndDate
					// Shown date is one day behind the actual end (for us it's excluded)
					const shownDate = incrementByRepeatPeriod(localDate, RepeatPeriod.DAILY, -1, this._zone)
					repeat.endValue = shownDate.getTime()
				}
				this.repeat = repeat
			} else {
				this.repeat = null
			}
			this.location(existingEvent.location)
			this.note(existingEvent.description)

			// TODO: alarms
			for (let alarmInfoId of existingEvent.alarmInfos) {
				if (isSameId(listIdPart(alarmInfoId), neverNull(this._user.alarmInfoList).alarms)) {
					load(UserAlarmInfoTypeRef, alarmInfoId).then((userAlarmInfo) => {
						this.addAlarm(downcast(userAlarmInfo.alarmInfo.trigger))
					})
				}
			}
		} else {
			const endTimeDate = new Date(date)
			endTimeDate.setMinutes(endTimeDate.getMinutes() + 30)
			this.startTime = timeString(date, this.amPmFormat)
			this.endTime = timeString(endTimeDate, this.amPmFormat)
			this.startDate = getStartOfDayWithZone(date, this._zone)
			this.endDate = getStartOfDayWithZone(date, this._zone)
			m.redraw()
		}
	}

	onStartTimeSelected(value: string) {
		this.startTime = value
		if (this.startDate.getTime() === this.endDate.getTime()) {
			this._adjustEndTime()
		}
	}

	onEndTimeSelected(value: string) {
		this.endTime = value
	}

	addAttendee(mailAddress: string) {
		const attendee = createCalendarEventAttendee({
			status: CalendarAttendeeStatus.NEEDS_ACTION,
			address: createEncryptedMailAddress({address: mailAddress}),
		})
		this.attendees.push(attendee)
	}

	_adjustEndTime() {
		const parsedOldStartTime = this._oldStartTime && parseTime(this._oldStartTime)
		const parsedStartTime = parseTime(this.startTime)
		const parsedEndTime = parseTime(this.endTime)
		if (!parsedStartTime || !parsedEndTime || !parsedOldStartTime) {
			return
		}
		const endTotalMinutes = parsedEndTime.hours * 60 + parsedEndTime.minutes
		const startTotalMinutes = parsedStartTime.hours * 60 + parsedStartTime.minutes
		const diff = Math.abs(endTotalMinutes - parsedOldStartTime.hours * 60 - parsedOldStartTime.minutes)
		const newEndTotalMinutes = startTotalMinutes + diff
		let newEndHours = Math.floor(newEndTotalMinutes / 60)
		if (newEndHours > 23) {
			newEndHours = 23
		}
		const newEndMinutes = newEndTotalMinutes % 60
		this.endTime = timeStringFromParts(newEndHours, newEndMinutes, this.amPmFormat)
		this._oldStartTime = this.startTime
	}

	onStartDateSelected(date: ?Date) {
		if (date) {
			// The custom ID for events is derived from the unix timestamp, and sorting the negative ids is a challenge we decided not to
			// tackle because it is a rare case.
			if (date && date.getFullYear() < TIMESTAMP_ZERO_YEAR) {
				const thisYear = (new Date()).getFullYear()
				let newDate = new Date(date)
				newDate.setFullYear(thisYear)
				this.startDate = newDate
			} else {
				this.startDate = date
			}
		}
	}

	onEndDateSelected(date: ?Date) {
		if (date) {
			this.endDate = date
		}
	}

	onRepeatPeriodSelected(repeatPeriod: ?RepeatPeriodEnum) {
		if (repeatPeriod == null) {
			this.repeat = null
		} else {
			// Provide default values if repeat is not there, override them with existing repeat if it's there, provide new frequency
			// First empty object is for Flow.
			this.repeat = Object.assign({}, {interval: 1, endType: EndType.Never, endValue: 1}, this.repeat, {frequency: repeatPeriod})
		}
	}

	onEndOccurencesSelected(endValue: number) {
		if (this.repeat && this.repeat.endType === EndType.Count) {
			this.repeat.endValue = endValue
		}
	}

	onRepeatEndDateSelected(endDate: ?Date) {
		const {repeat} = this
		if (endDate && repeat && repeat.endType === EndType.UntilDate) {
			repeat.endValue = endDate.getTime()
		}
	}

	onRepeatIntervalChanged(interval: number) {
		if (this.repeat) {
			this.repeat.interval = interval
		}
	}

	onRepeatEndTypeChanged(endType: EndTypeEnum) {
		const {repeat} = this
		if (repeat) {
			repeat.endType = endType
			if (endType === EndType.UntilDate) {
				// TODO: improve
				repeat.endValue = new Date().getTime()
			} else {
				repeat.endValue = 1
			}
		}
	}

	addAlarm(trigger: AlarmIntervalEnum) {
		const alarm = createCalendarAlarm(generateEventElementId(Date.now()), trigger)
		this.alarms = this.alarms.concat(alarm)
	}

	changeAlarm(identifier: string, trigger: ?AlarmIntervalEnum) {
		const newAlarms = this.alarms.slice()
		for (let i = 0; i < newAlarms.length; i++) {
			if (newAlarms[i].alarmIdentifier === identifier) {
				if (trigger) {
					newAlarms[i].trigger = trigger
				} else {
					newAlarms.splice(i, 1)
				}
				this.alarms = newAlarms
				break
			}
		}
	}

	canModifyGuests(): boolean {
		return true // TODO
	}

	removeAttendee(guest: CalendarEventAttendee) {
		remove(this.attendees, guest)
	}

	canModifyOwnAttendance(): boolean {
		return true // TODO
	}

	canModifyOrganizer(): bool {
		return true // TODO
	}

	/**
	 * @return Promise<bool> whether to close dialog
	 */
	deleteEvent(): Promise<bool> {
		// TODO: invite
		// if (isOwnEvent && existingEvent.attendees.length) {
		// 	sendCalendarCancellation(existingEvent, existingEvent.attendees.map(a => a.address))
		// }
		return erase(this.existingEvent).catch(NotFoundError, noOp)
	}

	onOkPressed(): boolean {
		// We have to use existing instance to get all the final fields correctly
		// Using clone feels hacky but otherwise we need to save all attributes of the existing event somewhere and if dialog is
		// cancelled we also don't want to modify passed event
		const newEvent = this.existingEvent ? clone(this.existingEvent) : createCalendarEvent()

		let startDate = new Date(this.startDate)
		let endDate = new Date(this.endDate)

		if (this.allDay()) {
			startDate = getAllDayDateUTCFromZone(startDate, this._zone)
			endDate = getAllDayDateUTCFromZone(getStartOfNextDayWithZone(endDate, this._zone), this._zone)
		} else {
			const parsedStartTime = parseTime(this.startTime)
			const parsedEndTime = parseTime(this.endTime)
			if (!parsedStartTime || !parsedEndTime) {
				// TODO: error dialog
				// Dialog.error("timeFormatInvalid_msg")
				return false
			}
			startDate.setHours(parsedStartTime.hours)
			startDate.setMinutes(parsedStartTime.minutes)

			// End date is never actually included in the event. For the whole day event the next day
			// is the boundary. For the timed one the end time is the boundary.
			endDate.setHours(parsedEndTime.hours)
			endDate.setMinutes(parsedEndTime.minutes)
		}

		if (endDate.getTime() <= startDate.getTime()) {
			// TODO: error dialog
			// Dialog.error('startAfterEnd_label')
			return false
		}
		newEvent.startTime = startDate
		newEvent.description = this.note()
		newEvent.summary = this.summary()
		newEvent.location = this.location()
		newEvent.endTime = endDate
		const groupRoot = this.selectedCalendar().groupRoot
		newEvent._ownerGroup = this.selectedCalendar().groupRoot._id
		newEvent.uid = this.existingEvent && this.existingEvent.uid ? this.existingEvent.uid : generateUid(newEvent, Date.now())
		const repeat = this.repeat
		if (repeat == null) {
			newEvent.repeatRule = null
		} else {
			const interval = repeat.interval || 1
			const repeatRule = createRepeatRuleWithValues(repeat.frequency, interval)
			newEvent.repeatRule = repeatRule

			const stopType = repeat.endType
			repeatRule.endType = stopType
			if (stopType === EndType.Count) {
				const count = repeat.endValue
				if (isNaN(count) || Number(count) < 1) {
					repeatRule.endType = EndType.Never
				} else {
					repeatRule.endValue = String(count)
				}
			} else if (stopType === EndType.UntilDate) {
				const repeatEndDate = getStartOfNextDayWithZone(new Date(repeat.endValue), this._zone)
				if (repeatEndDate.getTime() < getEventStart(newEvent, this._zone)) {
					// TODO: error dialog
					// Dialog.error("startAfterEnd_label")
					return false
				} else {
					// We have to save repeatEndDate in the same way we save start/end times because if one is timzone
					// dependent and one is not then we have interesting bugs in edge cases (event created in -11 could
					// end on another date in +12). So for all day events end date is UTC-encoded all day event and for
					// regular events it is just a timestamp.
					repeatRule.endValue = String((this.allDay() ? getAllDayDateUTCFromZone(repeatEndDate, this._zone) : repeatEndDate).getTime())
				}
			}
		}
		const newAlarms = this.alarms.slice()
		newEvent.attendees = this.attendees
		if (this.existingEvent) {
			newEvent.sequence = String(filterInt(this.existingEvent.sequence) + 1)
		}
		let newAttendees = []
		let existingAttendees = []

		newEvent.organizer = this.organizer

		// TODO: invites
		// if (isOwnEvent) {
		// 	if (existingEvent) {
		// 		attendees.forEach((a) => {
		// 			if (existingEvent.attendees.includes(a)) {
		// 				existingAttendees.push(a)
		// 			} else {
		// 				newAttendees.push(a)
		// 			}
		// 		})
		// 	} else {
		// 		newAttendees = attendees
		// 	}
		// } else {
		// 	if (ownAttendee && participationStatus() !== CalendarAttendeeStatus.NEEDS_ACTION
		// 		&& ownAttendee.status !== participationStatus()) {
		// 		ownAttendee.status = participationStatus()
		//
		// 		newEvent.attendees = attendees
		// 		sendCalendarInviteResponse(newEvent, createMailAddress({
		// 			name: ownAttendee.address.name,
		// 			address: ownAttendee.address.address,
		// 		}), participationStatus())
		// 	}
		// }

		const askedUpdate = Promise.resolve(false)
		// TODO: move this to the dialog
		//;(existingAttendees.length ? Dialog.confirm("sendEventUpdate_msg") : Promise.resolve(false))
		askedUpdate
			.then((shouldSendOutUpdates) => {
				let updatePromise
				const safeExistingEvent = this.existingEvent
				if (safeExistingEvent == null
					|| safeExistingEvent._ownerGroup !== newEvent._ownerGroup // event has been moved to another calendar
					|| newEvent.startTime.getTime() !== safeExistingEvent.startTime.getTime()
					|| !repeatRulesEqual(newEvent.repeatRule, safeExistingEvent.repeatRule)) {
					// if values of the existing events have changed that influence the alarm time then delete the old event and create a new one.
					assignEventId(newEvent, this._zone, groupRoot)
					// Reset ownerEncSessionKey because it cannot be set for new entity, it will be assigned by the CryptoFacade
					newEvent._ownerEncSessionKey = null
					// Reset permissions because server will assign them
					downcast(newEvent)._permissions = null

					// We don't want to pass event from ics file to the facade because it's just a template event and there's nothing ot clean
					// up.
					const oldEventToPass = safeExistingEvent && safeExistingEvent._ownerGroup ? safeExistingEvent : null
					updatePromise = worker.createCalendarEvent(newEvent, newAlarms, oldEventToPass)
				} else {
					updatePromise = worker.updateCalendarEvent(newEvent, newAlarms, safeExistingEvent)
				}

				// TODO: send out invites
				// updatePromise
				// 	// Let the dialog close first to avoid glitches
				// 	.delay(200)
				// 	.then(() => {
				// 		if (newAttendees.length) {
				// 			sendCalendarInvite(newEvent, newAlarms, newAttendees.map(a => a.address))
				// 		}
				// 		if (shouldSendOutUpdates) {
				// 			sendCalendarUpdate(newEvent, existingAttendees.map(a => a.address))
				// 		}
				// 		if (safeExistingEvent) {
				// 			const removedAttendees = safeExistingEvent.attendees.filter(att => !this.attendees.includes(att))
				// 			if (removedAttendees.length > 0) {
				// 				sendCalendarCancellation(safeExistingEvent, removedAttendees.map(a => a.address))
				// 			}
				// 		}
				// 	})
			})
		return true
	}

	selectGoing(going: CalendarAttendeeStatusEnum) {
		if (this.canModifyOwnAttendance()) {
			this.going = going
		}
	}
}

function createCalendarAlarm(identifier: string, trigger: string): AlarmInfo {
	const calendarAlarmInfo = createAlarmInfo()
	calendarAlarmInfo.alarmIdentifier = identifier
	calendarAlarmInfo.trigger = trigger
	return calendarAlarmInfo
}

// allDay event consists of full UTC days. It always starts at 00:00:00.00 of its start day in UTC and ends at
// 0 of the next day in UTC. Full day event time is relative to the local timezone. So startTime and endTime of
// allDay event just points us to the correct date.
// e.g. there's an allDay event in Europe/Berlin at 2nd of may. We encode it as:
// {startTime: new Date(Date.UTC(2019, 04, 2, 0, 0, 0, 0)), {endTime: new Date(Date.UTC(2019, 04, 3, 0, 0, 0, 0))}}
// We check the condition with time == 0 and take a UTC date (which is [2-3) so full day on the 2nd of May). We
function repeatRulesEqual(repeatRule: ?CalendarRepeatRule, repeatRule2: ?CalendarRepeatRule): boolean {
	return (repeatRule == null && repeatRule2 == null) ||
		(repeatRule != null && repeatRule2 != null &&
			repeatRule.endType === repeatRule2.endType &&
			repeatRule.endValue === repeatRule2.endValue &&
			repeatRule.frequency === repeatRule2.frequency &&
			repeatRule.interval === repeatRule2.interval &&
			repeatRule.timeZone === repeatRule2.timeZone)
}