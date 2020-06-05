//@flow
import {parseCalendarFile} from "./CalendarImporter"
import {worker} from "../api/main/WorkerClient"
import {showCalendarEventDialog} from "./CalendarEventDialog"
import m from "mithril"
import {DateTime} from "luxon"
import {Dialog} from "../gui/base/Dialog"
import type {CalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import type {File as TutanotaFile} from "../api/entities/tutanota/File"
import {loadCalendarInfos} from "./CalendarModel"
import {locator} from "../api/main/MainLocator"

function loadOrCreateCalendarInfo() {
	return loadCalendarInfos()
		.then((calendarInfo) =>
			calendarInfo.size && calendarInfo || worker.addCalendar("").then(() => loadCalendarInfos()))
}

function getParsedEvent(fileData: DataFile): ?{event: CalendarEvent, uid: string} {
	try {
		const {contents} = parseCalendarFile(fileData)
		const parsedEventWithAlarms = contents[0]
		if (parsedEventWithAlarms && parsedEventWithAlarms.event.uid) {
			return {event: parsedEventWithAlarms.event, uid: parsedEventWithAlarms.event.uid}
		} else {
			return null
		}
	} catch (e) {
		console.log(e)
		return null
	}
}

export function showEventDetailsFromFile(firstCalendarFile: TutanotaFile) {
	worker.downloadFileContent(firstCalendarFile)
	      .then((fileData) => {
		      const parsedEventWithAlarms = getParsedEvent(fileData)
		      if (parsedEventWithAlarms == null) {
			      Dialog.error("cannotOpenEvent_msg")
			      return
		      }
		      const parsedEvent = parsedEventWithAlarms.event
		      return Promise.all([
			      worker.getEventByUid(parsedEventWithAlarms.uid),
			      loadOrCreateCalendarInfo(),
			      locator.mailModel.getUserMailboxDetails(),
		      ]).then(([existingEvent, calendarInfo, mailboxDetails]) => {
			      if (existingEvent) {
				      // It should be the latest version eventually via CalendarEventUpdates
				      showCalendarEventDialog(existingEvent.startTime, calendarInfo, mailboxDetails, existingEvent)
			      } else {
			      	// Set isCopy here to show that this is not created by us
				      parsedEvent.isCopy = true
				      showCalendarEventDialog(parsedEvent.startTime, calendarInfo, mailboxDetails, parsedEvent)
			      }
		      })
	      })
}